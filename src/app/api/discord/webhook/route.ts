import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import {
  ackDiscordInteraction,
  bindDiscordByCode,
  consumeDiscordReadMoreToken,
  discordSendMessage,
  findDiscordLinkByChannel,
  getDiscordBotToken,
  sendDiscordFollowup,
  setDiscordActiveEmployee,
  setDiscordActiveWorkspace,
  unlinkDiscord,
  type DiscordActionRow,
} from "@/lib/discord";
import { enqueueOrRun } from "@/lib/ai/team-task";
import { EMPLOYEE_PERSONAS } from "@/lib/ai/employee-personas";

/**
 * POST /api/discord/webhook
 *
 * Internal route called by the persistent Discord gateway (lib/discord-gateway)
 * for every inbound DM. The gateway is just transport; this route is the brain
 * — it binds the user (/connect <code>), answers the same commands as Telegram
 * (/status, /workspaces, /team), and forwards anything else into the user's
 * Team Room or the selected employee's DM.
 *
 * Protected by an internal secret header the gateway sends (derived from the
 * bot token when DISCORD_INTERNAL_SECRET isn't set).
 */
export async function POST(request: NextRequest) {
  if (!getDiscordBotToken()) {
    return NextResponse.json({ error: "Bot not configured" }, { status: 500 });
  }

  const secret = process.env.DISCORD_INTERNAL_SECRET || `dg_${(getDiscordBotToken() ?? "").slice(-24)}`;
  const header = request.headers.get("x-internal-secret");
  if (header !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    authorId?: string;
    channelId?: string;
    text?: string;
    interaction?: {
      id?: string;
      token?: string;
      customId?: string;
      channelId?: string;
      applicationId?: string;
      userId?: string;
    };
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // ---- Button taps (Read more…, /team picker, /workspaces picker) -------
  const interaction = body.interaction;
  if (interaction && interaction.id && interaction.token) {
    void handleInteraction({
      id: interaction.id,
      token: interaction.token,
      customId: interaction.customId,
      channelId: interaction.channelId,
      applicationId: interaction.applicationId,
      userId: interaction.userId,
    });
    return NextResponse.json({ ok: true });
  }

  const channelId = body.channelId;
  const authorId = body.authorId;
  const text = (body.text ?? "").trim();
  if (!channelId || !authorId || !text) {
    return NextResponse.json({ ok: true });
  }

  // ---- /connect <code> — the bind flow --------------------------------
  const connectMatch = text.match(/^\/connect\s+([A-Za-z0-9]+)/);
  if (connectMatch) {
    const result = await bindDiscordByCode(connectMatch[1], authorId, channelId);
    if (result.ok) {
      await discordSendMessage(
        channelId,
        "✅ Connected! You'll now get your app notifications here. Try /status to see what's waiting."
      );
    } else {
      await discordSendMessage(
        channelId,
        `❌ ${result.error ?? "Could not connect that link."} Open the app → Settings → Discord and generate a fresh link.`
      );
    }
    return NextResponse.json({ ok: true });
  }

  // ---- Help -----------------------------------------------------------
  if (text === "/start" || text === "/help") {
    await discordSendMessage(
      channelId,
      "👋 This is your Agency OS bot.\n\n" +
        "/status — your latest updates in notifications\n" +
        "/workspaces — list and switch workspaces\n" +
        "/team — pick an employee to chat with directly\n" +
        "/unbind — disconnect this chat\n" +
        "Any other message is forwarded to your AI team."
    );
    return NextResponse.json({ ok: true });
  }

  const link = await findDiscordLinkByChannel(channelId);
  if (!link) {
    await discordSendMessage(
      channelId,
      "You're not connected yet. Open the app → Settings → Discord and tap Connect, then DM me `/connect <code>`."
    );
    return NextResponse.json({ ok: true });
  }

  // ---- Commands that need a binding ------------------------------------
  if (text === "/status") {
    await replyWithStatus(channelId, link.tenant_id);
    return NextResponse.json({ ok: true });
  }

  if (text === "/unbind") {
    await unlinkDiscord(link.user_id, link.tenant_id);
    await discordSendMessage(channelId, "👋 Disconnected. Your notifications will stop arriving here.");
    return NextResponse.json({ ok: true });
  }

  if (text === "/workspaces") {
    await listWorkspaces(channelId, link);
    return NextResponse.json({ ok: true });
  }

  const workspaceMatch = text.match(/^\/workspace\s+(.+)$/);
  if (workspaceMatch) {
    await selectWorkspace(channelId, link, workspaceMatch[1].trim());
    return NextResponse.json({ ok: true });
  }

  if (text === "/team" || text === "/team ") {
    await listTeam(channelId, link);
    return NextResponse.json({ ok: true });
  }
  const teamMatch = text.match(/^\/team\s+(.+)$/);
  if (teamMatch) {
    await selectTeam(channelId, link, teamMatch[1].trim());
    return NextResponse.json({ ok: true });
  }

  // ---- Anything else → forward to the team / selected employee ----------
  void forwardToChat({
    channelId,
    tenantId: link.tenant_id,
    workspaceId: link.active_workspace_id ?? null,
    employeeKey: link.active_employee_key ?? null,
    text,
  });

  return NextResponse.json({ ok: true });
}

/** /status — the user's 5 most recent unread notifications. */
async function replyWithStatus(channelId: string, tenantId: string) {
  const supabase = await createServiceClient();
  const { data, error } = await supabase
    .from("notifications")
    .select("kind, title, body, link, created_at")
    .eq("tenant_id", tenantId)
    .is("read_at", null)
    .order("created_at", { ascending: false })
    .limit(5);
  if (error || !data || data.length === 0) {
    await discordSendMessage(channelId, "🎉 All caught up — no unread notifications.");
    return;
  }
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://platform.blissmedialab.com";
  const emoji = { info: "ℹ️", progress: "🔄", approval: "✅", alert: "🚨" } as const;
  const lines = data.map((n, i) => {
    const kind = (n.kind ?? "info") as keyof typeof emoji;
    const link = n.link ? `\n🔗 ${site}${n.link}` : "";
    return `${i + 1}. ${emoji[kind] ?? "🔔"} ${(n.title ?? "").slice(0, 160)}${link}`;
  });
  await discordSendMessage(
    channelId,
    `**Unread notifications (${data.length}):**\n\n${lines.join("\n\n")}`
  );
}

/** /workspaces — list the tenant's workspaces with one-tap buttons. */
async function listWorkspaces(
  channelId: string,
  link: { tenant_id: string; active_workspace_id?: string | null }
) {
  const supabase = await createServiceClient();
  const { data, error } = await supabase
    .from("workspaces")
    .select("id, name")
    .eq("tenant_id", link.tenant_id)
    .order("created_at", { ascending: true });
  if (error || !data || data.length === 0) {
    await discordSendMessage(channelId, "No workspaces found for your account.");
    return;
  }
  const current = link.active_workspace_id;
  const lines = data.map((w, i) => {
    const mark = w.id === current ? " ✅ (current)" : "";
    return `${i + 1}. ${w.name ?? "Workspace"}${mark}`;
  });
  // One-tap buttons (5 per row, max 25 — Discord's component cap).
  const rows: DiscordActionRow[] = [];
  for (let i = 0; i < data.length && i < 25; i += 5) {
    rows.push({
      type: 1,
      components: data.slice(i, i + 5).map((w) => ({
        type: 2,
        style: w.id === current ? 3 : 1,
        label: `${(w.name ?? "Workspace").slice(0, 24)}${w.id === current ? " ✓" : ""}`,
        custom_id: `ws:${w.id}`,
      })),
    });
  }
  const tooMany = data.length > 25 ? `\n\n(Only the first 25 shown — use /workspace <name> for the rest.)` : "";
  await discordSendMessage(
    channelId,
    `**Your workspaces:**\n${lines.join("\n")}\n\nTap a button to switch.${tooMany}`,
    rows
  );
}

/** /workspace <n|name> — set the active workspace for this DM. */
async function selectWorkspace(
  channelId: string,
  link: { tenant_id: string },
  arg: string
) {
  const supabase = await createServiceClient();
  const { data, error } = await supabase
    .from("workspaces")
    .select("id, name")
    .eq("tenant_id", link.tenant_id)
    .order("created_at", { ascending: true });
  if (error || !data || data.length === 0) {
    await discordSendMessage(channelId, "No workspaces found for your account.");
    return;
  }
  let target = data[0];
  const n = Number.parseInt(arg, 10);
  if (!Number.isNaN(n) && n >= 1 && n <= data.length) {
    target = data[n - 1];
  } else {
    const byName = data.find((w) => (w.name ?? "").toLowerCase() === arg.toLowerCase());
    if (byName) target = byName;
    else {
      await discordSendMessage(channelId, `Couldn't find "${arg}". Use /workspaces to see the list.`);
      return;
    }
  }
  const res = await setDiscordActiveWorkspace(channelId, target.id);
  if (!res.ok) {
    await discordSendMessage(channelId, `❌ ${res.error ?? "Couldn't switch workspace."}`);
    return;
  }
  await discordSendMessage(
    channelId,
    `✅ Active workspace is now **${target.name ?? "Workspace"}**. New messages go to that workspace's Team Room.`
  );
}

/** /team — list the roster with one-tap buttons. */
async function listTeam(
  channelId: string,
  link: { active_employee_key?: string | null }
) {
  const current = link.active_employee_key;
  const keys = Object.keys(EMPLOYEE_PERSONAS) as string[];
  const lines = keys.map((k) => {
    const p = EMPLOYEE_PERSONAS[k as keyof typeof EMPLOYEE_PERSONAS];
    if (!p) return "";
    return `${p.name} — ${p.role}${k === current ? " ✅ (current)" : ""}`;
  });
  // One-tap employee buttons (3 per row; 12 employees = 4 rows) + a green
  // Team Room button on its own row = 5 rows, within Discord's cap.
  const rows: DiscordActionRow[] = [];
  for (let i = 0; i < keys.length; i += 3) {
    rows.push({
      type: 1,
      components: keys.slice(i, i + 3).map((k) => {
        const p = EMPLOYEE_PERSONAS[k as keyof typeof EMPLOYEE_PERSONAS];
        return {
          type: 2,
          style: k === current ? 3 : 1,
          label: `${p?.name ?? k}${k === current ? " ✓" : ""}`,
          custom_id: `tm:${k}`,
        };
      }),
    });
  }
  rows.push({
    type: 1,
    components: [
      { type: 2, style: 4, label: "🏠 Team Room", custom_id: "tm:__room__" },
    ],
  });
  await discordSendMessage(
    channelId,
    `**Who do you want to talk to?**\n\n${lines.join("\n")}\n\nTap a button, or /team <name> (e.g. /team Cheryl). /team off returns to the Team Room.`,
    rows
  );
}

/** /team <name|key|off> — set (or clear) the direct employee for this DM. */
async function selectTeam(
  channelId: string,
  link: { tenant_id: string },
  arg: string
) {
  const lower = arg.toLowerCase();
  if (lower === "off" || lower === "room" || lower === "reset" || lower === "none") {
    const res = await setDiscordActiveEmployee(channelId, null);
    if (!res.ok) {
      await discordSendMessage(channelId, `❌ ${res.error ?? "Couldn't switch back to the Team Room."}`);
      return;
    }
    await discordSendMessage(channelId, "✅ Back to your **Team Room** — new messages go to the whole team again.");
    return;
  }
  let key: string | null = null;
  if (EMPLOYEE_PERSONAS[lower as keyof typeof EMPLOYEE_PERSONAS]) {
    key = lower;
  } else {
    const byName = (Object.keys(EMPLOYEE_PERSONAS) as string[]).find((k) => {
      const p = EMPLOYEE_PERSONAS[k as keyof typeof EMPLOYEE_PERSONAS];
      return (p?.name ?? "").toLowerCase() === lower;
    });
    if (byName) key = byName;
  }
  if (!key) {
    await discordSendMessage(channelId, `Couldn't find "${arg}". Use /team to see the roster.`);
    return;
  }
  const persona = EMPLOYEE_PERSONAS[key as keyof typeof EMPLOYEE_PERSONAS];
  const res = await setDiscordActiveEmployee(channelId, key);
  if (!res.ok) {
    await discordSendMessage(channelId, `❌ ${res.error ?? "Couldn't switch employee."}`);
    return;
  }
  await discordSendMessage(
    channelId,
    `✅ Now chatting directly with **${persona?.name ?? key}** (${persona?.role ?? ""}). Message me anything and it goes straight to them. /team off returns to the Team Room.`
  );
}

/**
 * Insert the message into the user's Team Room (or the selected employee's DM)
 * and enqueue the normal employee pipeline. Serialized per chat so replies
 * never interleave, and never awaited — the route returns before the LLM work
 * starts.
 */
async function forwardToChat(input: {
  channelId: string;
  tenantId: string;
  workspaceId: string | null;
  employeeKey: string | null;
  text: string;
}): Promise<void> {
  try {
    const supabase = await createServiceClient();
    const employeeKey = input.employeeKey && input.employeeKey !== "nina" ? input.employeeKey : null;

    let { data: room } = await supabase
      .from("team_chats")
      .select("id, workspace_id, tenant_id")
      .eq("tenant_id", input.tenantId)
      .eq("workspace_id", input.workspaceId)
      .eq("kind", employeeKey ? "employee" : "team")
      .eq("employee_key", employeeKey ?? null)
      .maybeSingle();
    if (!room) {
      const { data: created, error } = await supabase
        .from("team_chats")
        .insert({
          tenant_id: input.tenantId,
          workspace_id: input.workspaceId,
          client_id: null,
          title: employeeKey
            ? (EMPLOYEE_PERSONAS[employeeKey as keyof typeof EMPLOYEE_PERSONAS]?.name ?? employeeKey)
            : "Team Room",
          kind: employeeKey ? "employee" : "team",
          employee_key: employeeKey ?? null,
        })
        .select("id, workspace_id, tenant_id")
        .single();
      if (error) {
        await discordSendMessage(input.channelId, "Couldn't open the chat — try again in a moment.");
        return;
      }
      room = created;
    }

    const roomId = room.id as string;
    await enqueueOrRun({
      chatId: roomId,
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      content: input.text,
      queue: (payload) => {
        const prev = chatQueues.get(roomId) ?? Promise.resolve();
        const next = prev.then(
          () => processInline(payload),
          () => processInline(payload)
        );
        chatQueues.set(roomId, next);
        void next.finally(() => {
          if (chatQueues.get(roomId) === next) chatQueues.delete(roomId);
        });
        return next;
      },
    });
  } catch (err) {
    console.error("[discord] forwardToChat failed:", err);
    await discordSendMessage(input.channelId, "Something went wrong reaching your team — please try again.");
  }
}

/**
 * Handle a button tap (interaction): Read-more, employee picker, workspace
 * picker. Acknowledges fast (Discord's 3s window) then sends the follow-up.
 * Fire-and-forget so the route answers quickly.
 */
async function handleInteraction(input: {
  id: string;
  token: string;
  customId?: string;
  channelId?: string;
  applicationId?: string;
  userId?: string;
}): Promise<void> {
  void ackDiscordInteraction(input.id, input.token);
  try {
    const follow = (text: string) => sendDiscordFollowup(input.applicationId ?? "", input.token, text);
    const customId = input.customId ?? "";

    if (customId.startsWith("rm:")) {
      const token = customId.slice(3);
      const full = await consumeDiscordReadMoreToken(token);
      if (!full) {
        await follow("That full message is no longer cached — ask again and I'll resend it in one piece.");
        return;
      }
      await follow(full);
      return;
    }

    if (customId.startsWith("tm:")) {
      const employeeKey = customId.slice(3);
      const link = input.channelId ? await findDiscordLinkByChannel(input.channelId) : null;
      if (!link) {
        await follow("You're not connected yet. Open the app → Settings → Discord and tap Connect, then DM me `/connect <code>`.");
        return;
      }
      if (employeeKey === "__room__") {
        const res = await setDiscordActiveEmployee(input.channelId ?? "", null);
        await follow(
          res.ok
            ? "✅ Back to your **Team Room** — new messages go to the whole team again."
            : `❌ ${res.error ?? "Couldn't switch back to the Team Room."}`
        );
        return;
      }
      const persona = EMPLOYEE_PERSONAS[employeeKey as keyof typeof EMPLOYEE_PERSONAS];
      if (!persona) {
        await follow("Unknown employee.");
        return;
      }
      const res = await setDiscordActiveEmployee(input.channelId ?? "", employeeKey);
      await follow(
        res.ok
          ? `✅ Now chatting directly with **${persona.name}** (${persona.role}). Message me anything and it goes straight to them. /team off returns to the Team Room.`
          : `❌ ${res.error ?? "Couldn't switch employee."}`
      );
      return;
    }

    if (customId.startsWith("ws:")) {
      const workspaceId = customId.slice(3);
      const link = input.channelId ? await findDiscordLinkByChannel(input.channelId) : null;
      if (!link) {
        await follow("You're not connected yet. Open the app → Settings → Discord and tap Connect.");
        return;
      }
      const supabase = await createServiceClient();
      const { data: ws } = await supabase
        .from("workspaces")
        .select("name")
        .eq("id", workspaceId)
        .eq("tenant_id", link.tenant_id)
        .maybeSingle();
      if (!ws) {
        await follow("Workspace not found.");
        return;
      }
      const res = await setDiscordActiveWorkspace(input.channelId ?? "", workspaceId);
      await follow(
        res.ok
          ? `✅ Active workspace is now **${ws.name}**. New messages go to that workspace's Team Room.`
          : `❌ ${res.error ?? "Couldn't switch workspace."}`
      );
      return;
    }

    await follow("Unknown action.");
  } catch (err) {
    console.warn("[discord] handleInteraction failed:", err);
  }
}

/** Serialized inline task runner, mirroring the web app's chat behavior. */
const chatQueues = new Map<string, Promise<void>>();
async function processInline(payload: {
  chatId: string;
  tenantId: string;
  workspaceId: string | null;
  userMessage: string;
  taskId: string;
}) {
  const { processTeamTask } = await import("@/lib/ai/team-task");
  const attempts = 3;
  for (let i = 0; i < attempts; i++) {
    try {
      await processTeamTask(payload);
      return;
    } catch (err) {
      console.warn(`[discord] task attempt ${i + 1}/${attempts} failed:`, err);
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 1500 * 2 ** i));
    }
  }
}
