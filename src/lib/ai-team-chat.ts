"use server";

// ============================================================================
// AI Team Chat — server actions + send pipeline.
//
// Phase 1 of the AI Team Chat:
//   - A chat instance per (tenant, workspace, client, kind) — the Team Room
//     where Malory dispatches, plus per-employee DMs.
//   - Messages are authored by a user or an AI employee (employee_key), so the
//     UI renders visible sender handoffs (Malory → Pam → Cheryl).
//   - Malory (nina) dispatches: a structured call classifies the request and
//     hands it to the right employee. Content requests go to Cheryl (penny),
//     who runs the real blog pipeline (text + images + draft post) and replies
//     with a link to the draft.
//
// All access goes through tenantScopedClient (tenant_id forced on write,
// auto-filtered on read) + assertTenantOwner for by-id lookups.
// ============================================================================

import { getTenantId, requireRole } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import {
  tenantScopedClient,
  assertTenantOwner,
} from "@/lib/supabase/tenant-scope";
import { getCurrentWorkspaceId } from "@/lib/workspace";
import { EMPLOYEE_KEYS } from "@/lib/ai/employee-keys";
import { EMPLOYEE_PERSONAS } from "@/lib/ai/employee-personas";
import { inngest } from "@/lib/inngest/client";
import {
  enqueueOrRun,
  processTeamTask,
  type TeamTaskPayload,
} from "@/lib/ai/team-task";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export interface TeamChat {
  id: string;
  tenant_id: string;
  workspace_id: string | null;
  client_id: string | null;
  title: string;
  kind: "team" | "employee" | "room";
  employee_key: string | null;
  /** Group rooms: the employee keys currently in the chat. */
  participants?: string[] | null;
  /** Optional folder/project label (migration 068). Null until the column
   * lands — select("*") omits it, so clients must treat it as optional. */
  folder?: string | null;
  created_at: string;
}

export interface TeamMessage {
  id: string;
  chat_id: string;
  tenant_id: string;
  role: "user" | "employee" | "system";
  employee_key: string | null;
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface ActionResponse<T = void> {
  success: boolean;
  data?: T;
  error?: string;
}

/** All known employee keys — defined in src/lib/ai/employee-keys.ts (client-safe). */
// ----------------------------------------------------------------------------
// Chat task execution — serialized per chat + retry-with-backoff.
// ----------------------------------------------------------------------------

/**
 * Per-chat execution chains. Multiple sends to the same chat are processed
 * ONE AT A TIME (first task fully completes — including its final reply —
 * before the next starts), so replies from different employees never
 * interleave into a jumbled thread.
 */
const chatQueues = new Map<string, Promise<void>>();

function enqueueChatTask(
  chatId: string,
  fn: () => Promise<void>
): Promise<void> {
  const prev = chatQueues.get(chatId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  chatQueues.set(chatId, next);
  void next.finally(() => {
    if (chatQueues.get(chatId) === next) chatQueues.delete(chatId);
  });
  return next;
}

/**
 * Run a chat task with retry-with-backoff. `processTeamTask` only throws for
 * failures before its internal try/catch (Supabase client creation, the
 * chat lookup, the tenant check) — exactly the "died before posting
 * anything" case that used to leave a chat stuck at "reviewing" forever.
 * Those are retried with backoff; if every attempt fails, a visible failure
 * status is posted so the client's spinner always resolves.
 */
async function runTaskWithRetry(payload: TeamTaskPayload): Promise<void> {
  const attempts = 3;
  for (let i = 0; i < attempts; i++) {
    try {
      await processTeamTask(payload);
      return;
    } catch (err) {
      console.warn(
        `[team-chat] Task attempt ${i + 1}/${attempts} failed before dispatch:`,
        err
      );
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, 1500 * 2 ** i)); // 1.5s, 3s
      }
    }
  }
  // Last resort — never leave the thread hanging.
  try {
    const sb = tenantScopedClient(await createServiceClient(), payload.tenantId);
    await sb.from("team_messages").insert({
      chat_id: payload.chatId,
      role: "system",
      employee_key: null,
      content:
        "Something went wrong processing that request — it failed after retrying. Please send it again.",
      metadata: { status: true, stage: "failed", taskId: payload.taskId },
    });
  } catch (err) {
    console.error("[team-chat] Could not post final failure:", err);
  }
}

// ----------------------------------------------------------------------------
// Chat helpers
// ----------------------------------------------------------------------------

/** Get-or-create the Team Room for the current tenant + workspace. */
export async function getOrCreateTeamChat(): Promise<ActionResponse<TeamChat>> {
  try {
    const tenantId = await getTenantId();
    const supabase = tenantScopedClient(await createServiceClient(), tenantId);
    const workspaceId = await getCurrentWorkspaceId();

    const { data: existing } = await supabase
      .from("team_chats")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("kind", "team")
      .maybeSingle();
    if (existing) return { success: true, data: existing as TeamChat };

    const { data, error } = await supabase
      .from("team_chats")
      .insert({
        workspace_id: workspaceId,
        client_id: null,
        title: "Team Room",
        kind: "team",
        employee_key: null,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return { success: true, data: data as TeamChat };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/** Get-or-create the DM chat with one employee for this tenant + workspace. */
export async function getOrCreateEmployeeChat(
  employeeKey: string
): Promise<ActionResponse<TeamChat>> {
  try {
    const tenantId = await getTenantId();
    const supabase = tenantScopedClient(await createServiceClient(), tenantId);
    const workspaceId = await getCurrentWorkspaceId();

    if (!(EMPLOYEE_KEYS as readonly string[]).includes(employeeKey)) {
      return { success: false, error: `Unknown AI employee: ${employeeKey}` };
    }

    const { data: existing } = await supabase
      .from("team_chats")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("kind", "employee")
      .eq("employee_key", employeeKey)
      .maybeSingle();
    if (existing) return { success: true, data: existing as TeamChat };

    const { data, error } = await supabase
      .from("team_chats")
      .insert({
        workspace_id: workspaceId,
        client_id: null,
        title: employeeKey,
        kind: "employee",
        employee_key: employeeKey,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return { success: true, data: data as TeamChat };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/**
 * A chat plus its unread indicator state. `unreadCount` is the number of
 * employee messages newer than the owner's last read time for that chat;
 * `unreadPriority` is the highest severity among them (urgent > important >
 * normal) so the sidebar light can color green/orange/red. The last-read map
 * lives client-side (localStorage) and is passed in by the chat page.
 */
export interface TeamChatSummary extends TeamChat {
  unreadCount?: number;
  unreadPriority?: "urgent" | "important" | "normal";
}

/** List this tenant's chats (team room + DMs) for the current workspace. */
export async function getChats(
  lastReadAt?: Record<string, string>
): Promise<ActionResponse<TeamChatSummary[]>> {
  try {
    const tenantId = await getTenantId();
    const supabase = tenantScopedClient(await createServiceClient(), tenantId);
    const workspaceId = await getCurrentWorkspaceId();

    const { data, error } = await supabase
      .from("team_chats")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at");
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as TeamChat[];

    // Unread state: employee messages newer than the last-read timestamp,
    // with the highest priority among them driving the light color.
    const ids = rows.map((r) => r.id);
    const unread: Record<
      string,
      { count: number; priority: "urgent" | "important" | "normal" }
    > = {};
    if (ids.length > 0) {
      const { data: msgs } = await supabase
        .from("team_messages")
        .select("chat_id, created_at, role, metadata")
        .in("chat_id", ids)
        .order("created_at", { ascending: false })
        .limit(1000);
      const rank = { urgent: 3, important: 2, normal: 1 } as const;
      for (const m of msgs ?? []) {
        if (m.role !== "employee") continue;
        const u = unread[m.chat_id] ?? {
          count: 0,
          priority: "normal" as const,
        };
        const readAt = lastReadAt?.[m.chat_id];
        if (readAt && new Date(m.created_at) <= new Date(readAt)) continue;
        u.count += 1;
        const raw = ((m.metadata as Record<string, unknown>)?.priority ??
          "normal") as string;
        const pr: "urgent" | "important" | "normal" =
          raw === "urgent"
            ? "urgent"
            : raw === "important"
              ? "important"
              : "normal";
        if (rank[pr] > rank[u.priority]) u.priority = pr;
        unread[m.chat_id] = u;
      }
    }

    const summary: TeamChatSummary[] = rows.map((r) => ({
      ...r,
      unreadCount: unread[r.id]?.count ?? 0,
      unreadPriority: unread[r.id]?.priority ?? "normal",
    }));
    return { success: true, data: summary };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/** Load the messages of one chat (tenant-ownership enforced). */
export async function getMessages(
  chatId: string
): Promise<ActionResponse<TeamMessage[]>> {
  try {
    const tenantId = await getTenantId();
    const supabase = tenantScopedClient(await createServiceClient(), tenantId);

    const { data: chat } = await supabase
      .from("team_chats")
      .select("*")
      .eq("id", chatId)
      .maybeSingle();
    assertTenantOwner(chat as TeamChat | null, tenantId, "chat");

    const { data, error } = await supabase
      .from("team_messages")
      .select("*")
      .eq("chat_id", chatId)
      .order("created_at");
    if (error) throw new Error(error.message);
    return { success: true, data: (data ?? []) as TeamMessage[] };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

// ----------------------------------------------------------------------------
// Workspace organization — chats are isolated per workspace (the unique
// constraint on team_chats scopes them by workspace_id). Move lets the owner
// relocate a chat to another workspace for per-client campaign organization.
// ----------------------------------------------------------------------------

/**
 * Create a new named chat room in the current workspace. Rooms are unlimited
 * per workspace (kind 'room') — the Team Room and DMs stay unique, but users
 * can spin up topic/client-specific chats and revisit their history later.
 */
export async function createChatRoom(
  title: string
): Promise<ActionResponse<TeamChat>> {
  try {
    const tenantId = await getTenantId();
    const supabase = tenantScopedClient(await createServiceClient(), tenantId);
    const workspaceId = await getCurrentWorkspaceId();

    const clean = title.trim().replace(/\s+/g, " ").slice(0, 80);
    if (!clean) return { success: false, error: "Chat title is required" };

    const { data, error } = await supabase
      .from("team_chats")
      .insert({
        workspace_id: workspaceId,
        client_id: null,
        title: clean,
        kind: "room",
        employee_key: null,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return { success: true, data: data as TeamChat };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/** List the tenant's workspaces (for the chat move control). */
export async function getTenantWorkspaces(): Promise<
  ActionResponse<{ id: string; name: string }[]>
> {
  try {
    const tenantId = await getTenantId();
    const supabase = await createServiceClient();
    const { data, error } = await supabase
      .from("workspaces")
      .select("id, name")
      .eq("tenant_id", tenantId)
      .order("name");
    if (error) throw new Error(error.message);
    return {
      success: true,
      data: (data ?? []) as { id: string; name: string }[],
    };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Delete a chat and its entire message history. team_messages cascades on
 * chat_id, so one delete removes the thread; tenant ownership is enforced
 * before anything is removed. Rooms and DMs may be deleted; the Team Room
 * auto-recreates on next load (the UI hides the control for it).
 */
export async function deleteChat(
  chatId: string
): Promise<ActionResponse<void>> {
  try {
    const tenantId = await getTenantId();
    await requireRole("agency_editor");
    const supabase = tenantScopedClient(await createServiceClient(), tenantId);

    const { data: chat } = await supabase
      .from("team_chats")
      .select("*")
      .eq("id", chatId)
      .maybeSingle();
    assertTenantOwner(chat as TeamChat | null, tenantId, "chat");

    const { error } = await supabase.from("team_chats").delete().eq("id", chatId);
    if (error) throw new Error(error.message);
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/**
 * File a chat into a folder/project (or clear its folder with null). The
 * folder is a free-form label capped at 60 chars. If the folder column
 * doesn't exist yet (migration 068 not applied), fail with a clear message
 * instead of a cryptic Postgres error.
 */
export async function setChatFolder(
  chatId: string,
  folder: string | null
): Promise<ActionResponse<TeamChat>> {
  try {
    const tenantId = await getTenantId();
    await requireRole("agency_editor");
    const supabase = tenantScopedClient(await createServiceClient(), tenantId);

    const { data: chat } = await supabase
      .from("team_chats")
      .select("*")
      .eq("id", chatId)
      .maybeSingle();
    assertTenantOwner(chat as TeamChat | null, tenantId, "chat");

    const clean = folder
      ? folder.trim().replace(/\s+/g, " ").slice(0, 60)
      : null;

    const { data, error } = await supabase
      .from("team_chats")
      .update({ folder: clean })
      .eq("id", chatId)
      .select("*")
      .single();
    if (error) {
      if (/column .*folder.* does not exist|Could not find the 'folder' column/i.test(error.message)) {
        return {
          success: false,
          error: "Folders aren't enabled yet — apply migration 068 to add the folder column.",
        };
      }
      throw new Error(error.message);
    }
    return { success: true, data: data as TeamChat };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Move a chat (and all its messages, which reference chat_id) to another of
 * the tenant's workspaces. Enforces tenant ownership on both sides and the
 * unique (workspace, kind, employee) constraint in the destination.
 */
export async function moveChatToWorkspace(
  chatId: string,
  targetWorkspaceId: string
): Promise<ActionResponse<TeamChat>> {
  try {
    const tenantId = await getTenantId();
    await requireRole("agency_editor");
    const supabase = tenantScopedClient(await createServiceClient(), tenantId);

    // Load + verify the chat belongs to this tenant.
    const { data: chat } = await supabase
      .from("team_chats")
      .select("*")
      .eq("id", chatId)
      .maybeSingle();
    assertTenantOwner(chat as TeamChat | null, tenantId, "chat");
    const room = chat as TeamChat;

    if (targetWorkspaceId === room.workspace_id) {
      return { success: false, error: "This chat is already in that workspace." };
    }

    // The target workspace must exist and belong to this tenant.
    const { data: target } = await supabase
      .from("workspaces")
      .select("id")
      .eq("id", targetWorkspaceId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!target) {
      return { success: false, error: "Target workspace not found." };
    }

    // Destination must not already hold a chat with the same identity
    // (tenant, workspace, client, kind, employee) — the unique constraints
    // would reject the move anyway; fail with a helpful message instead.
    // Rooms are exempt: unlimited named rooms may coexist in any workspace.
    if (room.kind !== "room") {
      const { data: conflict } = await supabase
        .from("team_chats")
        .select("id")
        .eq("workspace_id", targetWorkspaceId)
        .eq("kind", room.kind)
        .eq("employee_key", room.employee_key)
        .eq("client_id", room.client_id)
        .maybeSingle();
      if (conflict) {
        return {
          success: false,
          error:
            room.kind === "team"
              ? "That workspace already has a Team Room."
              : "That workspace already has a chat with this employee.",
        };
      }
    }

    const { data, error } = await supabase
      .from("team_chats")
      .update({ workspace_id: targetWorkspaceId })
      .eq("id", chatId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return { success: true, data: data as TeamChat };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

// ----------------------------------------------------------------------------
// Malory dispatch — classify the request and hand it to the right employee.
// ----------------------------------------------------------------------------

// ----------------------------------------------------------------------------
// sendChatMessage — enqueue the employee task and return immediately.
//
// The heavy pipeline (Malory dispatch → handoff → employee work → reply) runs
// in the Inngest background worker (src/lib/ai/team-task.ts). This function
// only authenticates, verifies the chat, inserts the user's message + a
// "reviewing" status, and enqueues the task — the HTTP request returns in
// milliseconds and the UI polls the thread for progress. When Inngest is not
// configured (local dev), the same pipeline runs inline, fire-and-forget, so
// the experience is identical either way.
// ----------------------------------------------------------------------------

export async function sendChatMessage(
  chatId: string,
  content: string
): Promise<ActionResponse<{ messages: TeamMessage[]; taskId: string }>> {
  try {
    const tenantId = await getTenantId();
    await requireRole("agency_editor");
    const message = content.trim();
    if (!message) return { success: false, error: "Message cannot be empty" };

    const supabase = tenantScopedClient(await createServiceClient(), tenantId);
    const { data: chat } = await supabase
      .from("team_chats")
      .select("*")
      .eq("id", chatId)
      .maybeSingle();
    assertTenantOwner(chat as TeamChat | null, tenantId, "chat");
    const room = chat as TeamChat;

    const result = await enqueueOrRun({
      chatId,
      tenantId,
      workspaceId: room.workspace_id,
      content: message,
      queue: async (payload: TeamTaskPayload) => {
        // Run the chat pipeline in THIS long-lived process (fire-and-forget)
        // instead of round-tripping through Inngest Cloud. A chat task posts
        // progress messages as it goes and can take minutes (dispatch, then a
        // full blog with images and up to 5 score-gate retries); an external
        // cloud callback can time out or be dropped mid-run, which left tasks
        // stuck at "reviewing" with no handoff and no reply. The VPS runs
        // `next start` as a persistent process, so the async task survives the
        // request and the UI polls the thread to see each stage land live.
        // Set AI_TEAM_INNGEST=true to opt back into the Inngest worker.
        if (
          process.env.AI_TEAM_INNGEST === "true" &&
          process.env.NODE_ENV === "production" &&
          process.env.INNGEST_EVENT_KEY
        ) {
          await inngest.send({
            name: "ai-team/employee-task",
            data: payload,
          });
          return;
        }
        // Inline: run in this process, serialized per chat (one task at a
        // time per chat — no interleaved replies) and retried with backoff
        // so a task that dies before dispatch re-runs instead of leaving a
        // stuck status. NOT awaited: the HTTP request returns immediately
        // and the UI polls the thread.
        void enqueueChatTask(payload.chatId, () => runTaskWithRetry(payload));
      },
    });
    if (!result.success) return { success: false, error: result.error };
    return {
      success: true,
      data: {
        messages: result.messages ?? [],
        taskId: result.taskId ?? "",
      },
    };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Stop an in-flight chat task. Inserts a cancellation signal the worker checks
 * between stages (and per image) — the task then stops without posting a reply
 * and the "Stopped by you." status resolves in the UI.
 */
export async function cancelTeamTask(
  chatId: string,
  taskId: string
): Promise<ActionResponse<void>> {
  try {
    const tenantId = await getTenantId();
    const supabase = tenantScopedClient(await createServiceClient(), tenantId);

    const { data: chat } = await supabase
      .from("team_chats")
      .select("*")
      .eq("id", chatId)
      .maybeSingle();
    assertTenantOwner(chat as TeamChat | null, tenantId, "chat");

    const { error } = await supabase.from("team_messages").insert({
      chat_id: chatId,
      role: "system",
      employee_key: null,
      content: "Stopped by you.",
      metadata: { status: true, stage: "cancelled", taskId, cancel: true },
    });
    if (error) throw new Error(error.message);
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Invite an employee into a chat. A DM becomes a group room (kind 'room')
 * with both employees as participants; further invites append to the room.
 */
export async function inviteEmployeeToChat(
  chatId: string,
  employeeKey: string
): Promise<ActionResponse<TeamChat>> {
  try {
    const tenantId = await getTenantId();
    await requireRole("agency_editor");
    const supabase = tenantScopedClient(await createServiceClient(), tenantId);

    if (!(EMPLOYEE_KEYS as readonly string[]).includes(employeeKey)) {
      return { success: false, error: `Unknown AI employee: ${employeeKey}` };
    }

    const { data: chat } = await supabase
      .from("team_chats")
      .select("*")
      .eq("id", chatId)
      .maybeSingle();
    assertTenantOwner(chat as TeamChat | null, tenantId, "chat");
    const room = chat as TeamChat;

    const current: string[] = Array.isArray(room.participants)
      ? (room.participants as string[])
      : room.kind === "employee" && room.employee_key
        ? [room.employee_key]
        : [];
    if (current.includes(employeeKey)) {
      return { success: false, error: "That employee is already in this chat." };
    }

    const participants = [...current, employeeKey];
    const nameOf = (k: string) =>
      EMPLOYEE_PERSONAS[k as keyof typeof EMPLOYEE_PERSONAS]?.name ?? k;
    // A DM converted to a group takes a descriptive title; a room keeps its
    // title.
    const title =
      room.kind === "employee"
        ? participants.map(nameOf).join(" + ")
        : room.title;

    const { data, error } = await supabase
      .from("team_chats")
      .update({
        kind: "room",
        employee_key: null,
        participants,
        title,
      })
      .eq("id", chatId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return { success: true, data: data as TeamChat };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}
