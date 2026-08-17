import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import {
  answerTelegramCallback,
  bindTelegramChatByCode,
  getTelegramBotToken,
  getTelegramFileUrl,
  sendLongTelegramMessage,
  sendReadMoreFullText,
  sendTelegramMessage,
  setTelegramActiveWorkspace,
  telegramCreateWorkspace,
  unlinkTelegram,
} from "@/lib/telegram";
import { enqueueOrRun } from "@/lib/ai/team-task";
import { persistImageToStorage } from "@/lib/media/storage";

/**
 * POST /api/telegram/webhook
 *
 * Telegram calls this for every message sent to the bot. It handles:
 *   - `/start <code>`  — consume the one-time link code and bind this chat to
 *                        the user who generated it (the "Connect Telegram"
 *                        flow from Settings).
 *   - `/status`        — the user's latest unread in-app notifications.
 *   - `/unbind`        — disconnect this chat from the app.
 *   - anything else    — forwarded into the user's Team Room, where Malory
 *                        dispatches it exactly as if typed in the app. The
 *                        reply lands back in the app thread AND is mirrored
 *                        here via the notification bridge.
 *
 * Always answers 200 fast — Telegram retries non-200s. All heavy work runs
 * fire-and-forget after the response.
 */
export async function POST(request: NextRequest) {
  const token = getTelegramBotToken();
  if (!token) {
    return NextResponse.json({ error: "Bot not configured" }, { status: 500 });
  }

  // Webhook secret: when TELEGRAM_WEBHOOK_SECRET is set, every update must
  // carry it in the X-Telegram-Bot-Api-Secret-Token header.
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret) {
    const header = request.headers.get("x-telegram-bot-api-secret-token");
    if (header !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  let update: {
    message?: {
      chat?: { id?: number };
      text?: string;
      caption?: string;
      photo?: { file_id: string; width: number; height: number }[];
      from?: { id?: number; username?: string; first_name?: string };
    };
    callback_query?: {
      id?: string;
      data?: string;
      from?: { id?: number };
      message?: { chat?: { id?: number } };
    };
  };
  try {
    update = (await request.json()) as typeof update;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // ---- Inline-button taps (Read more…, workspace picker) ------------------
  const callback = update.callback_query;
  if (callback && typeof callback.id === "string" && callback.data) {
    const cbChatId = callback.message?.chat?.id;
    const cbChatIdStr = typeof cbChatId === "number" ? String(cbChatId) : null;
    if (!cbChatIdStr) {
      await answerTelegramCallback(callback.id, "Couldn't resolve this chat.");
      return NextResponse.json({ ok: true });
    }
    void handleCallback(callback.id, cbChatIdStr, callback.data);
    return NextResponse.json({ ok: true });
  }

  const msg = update.message;
  const chatId = msg?.chat?.id;
  if (!msg || typeof chatId !== "number") {
    return NextResponse.json({ ok: true });
  }
  const text = (msg.text ?? "").trim();
  const chatIdStr = String(chatId);

  // ---- Photo / image upload ------------------------------------------
  // The largest photo in the array is the original. Download it, persist to
  // the workspace's Bunny zone, and store it as an image asset (filed under
  // the user's first workspace). A caption becomes the asset prompt.
  if (Array.isArray(msg.photo) && msg.photo.length > 0) {
    const link = await findLinkByChatId(chatIdStr);
    if (!link) {
      await sendTelegramMessage(
        chatIdStr,
        "You're not connected yet. Open the app → Settings → Telegram and tap Connect first."
      );
      return NextResponse.json({ ok: true });
    }
    void saveTelegramPhoto({
      chatIdStr,
      tenantId: link.tenant_id,
      workspaceId: link.active_workspace_id ?? null,
      fileId: msg.photo[msg.photo.length - 1].file_id,
      caption: msg.caption,
    });
    return NextResponse.json({ ok: true });
  }

  // ---- /start <code> — the connect flow --------------------------------
  const startMatch = text.match(/^\/start\s+([A-Za-z0-9]+)/);
  if (startMatch) {
    const code = startMatch[1];
    const result = await bindTelegramChatByCode(code, chatIdStr, msg.from?.username ?? null);
    const firstName = msg.from?.first_name ?? "there";
    if (result.ok) {
      await sendTelegramMessage(
        chatIdStr,
        `✅ Connected, ${firstName}! You'll now get your app notifications here. Try /status to see what's waiting.`,
        { parseMode: "Markdown" }
      );
    } else {
      await sendTelegramMessage(
        chatIdStr,
        `❌ ${result.error ?? "Could not connect that link."} Open the app → Settings → Telegram and generate a fresh link.`
      );
    }
    return NextResponse.json({ ok: true });
  }

  // ---- Commands --------------------------------------------------------
  if (text === "/start" || text === "/help") {
    await sendTelegramMessage(
      chatIdStr,
      "👋 This is your Agency OS bot.\n\n" +
        "/status — your latest updates in notifications\n" +
        "/workspaces — list and switch workspaces\n" +
        "/newworkspace <name> — create a workspace from here\n" +
        "/unbind — disconnect this chat\n" +
        "Long replies include a Read more button so nothing gets cut off. Any other message is forwarded to your AI team.",
      { parseMode: "Markdown" }
    );
    return NextResponse.json({ ok: true });
  }

  if (text === "/workspaces") {
    await listWorkspaces(chatIdStr);
    return NextResponse.json({ ok: true });
  }

  const workspaceMatch = text.match(/^\/workspace\s+(.+)$/);
  if (workspaceMatch) {
    await selectWorkspace(chatIdStr, workspaceMatch[1].trim());
    return NextResponse.json({ ok: true });
  }

  if (text === "/status") {
    await replyWithStatus(chatIdStr);
    return NextResponse.json({ ok: true });
  }

  const newWorkspaceMatch = text.match(/^\/newworkspace\s+(.+)$/);
  if (newWorkspaceMatch || (text.startsWith("/newworkspace") && text.length > "/newworkspace".length)) {
    const link = await findLinkByChatId(chatIdStr);
    if (!link) {
      await sendTelegramMessage(
        chatIdStr,
        "You aren't connected to an app account yet."
      );
      return NextResponse.json({ ok: true });
    }
    const name = (newWorkspaceMatch ? newWorkspaceMatch[1].trim() : text.slice("/newworkspace".length).trim());
    const res = await telegramCreateWorkspace(link.tenant_id, name);
    if (!res.ok || !res.workspace) {
      await sendTelegramMessage(chatIdStr, `❌ ${res.error ?? "Couldn't create the workspace."}`);
      return NextResponse.json({ ok: true });
    }
    // Make the new workspace active right away so the follow-up message
    // lands in it, then confirm with a workspace picker.
    await setTelegramActiveWorkspace(chatIdStr, res.workspace.id);
    await sendTelegramMessage(
      chatIdStr,
      `✅ Workspace *${res.workspace.name}* created and set as your active workspace. New messages will go to its Team Room.`,
      { parseMode: "Markdown" }
    );
    return NextResponse.json({ ok: true });
  }

  if (text === "/unbind") {
    const link = await findLinkByChatId(chatIdStr);
    if (link) {
      await unlinkTelegram(link.user_id, link.tenant_id);
      await sendTelegramMessage(chatIdStr, "👋 Disconnected. Your notifications will stop arriving here.");
    } else {
      await sendTelegramMessage(chatIdStr, "You aren't connected to an app account.");
    }
    return NextResponse.json({ ok: true });
  }

  // ---- Anything else → forward to the user's Team Room ------------------
  const link = await findLinkByChatId(chatIdStr);
  if (!link) {
    await sendTelegramMessage(
      chatIdStr,
      "You're not connected yet. Open the app → Settings → Telegram and tap Connect, then come back and message me again."
    );
    return NextResponse.json({ ok: true });
  }

  // Fire-and-forget into the same inline pipeline the web app uses.
  void forwardToTeamRoom({
    chatIdStr,
    tenantId: link.tenant_id,
    workspaceId: link.active_workspace_id ?? null,
    text,
  });

  return NextResponse.json({ ok: true });
}

/** Download a Telegram photo, persist it, and store it as an image asset. */
async function saveTelegramPhoto(input: {
  chatIdStr: string;
  tenantId: string;
  workspaceId: string | null;
  fileId: string;
  caption?: string;
}): Promise<void> {
  try {
    const fileUrl = await getTelegramFileUrl(input.fileId);
    if (!fileUrl) {
      await sendTelegramMessage(input.chatIdStr, "Couldn't fetch that image — please try again.");
      return;
    }
    const supabase = await createServiceClient();
    const workspaceId = (await resolveWorkspaceId(input.tenantId, input.workspaceId)) ?? null;
    const url = await persistImageToStorage(input.tenantId, fileUrl);
    const prompt = (input.caption ?? "Telegram upload").trim().slice(0, 500) || "Telegram upload";
    const { error } = await supabase.from("media_assets").insert({
      tenant_id: input.tenantId,
      client_id: null,
      workspace_id: workspaceId,
      type: "image",
      prompt,
      url,
      metadata: { source: "telegram", width: null, height: null },
      status: "completed",
    });
    if (error) {
      console.warn("[telegram] savePhoto asset insert failed:", error.message);
      await sendTelegramMessage(input.chatIdStr, "Image saved, but I couldn't file it in the library.");
      return;
    }
    await sendTelegramMessage(
      input.chatIdStr,
      "📎 Image saved to your Asset Library (Images tab)."
    );
  } catch (err) {
    console.error("[telegram] savePhoto failed:", err);
    await sendTelegramMessage(input.chatIdStr, "Couldn't save that image — please try again.");
  }
}

async function findLinkByChatId(chatId: string) {
  const supabase = await createServiceClient();
  const { data, error } = await supabase
    .from("telegram_links")
    .select("*")
    .eq("chat_id", chatId)
    .maybeSingle();
  if (error || !data) return null;
  return data as {
    user_id: string;
    tenant_id: string;
    active_workspace_id?: string | null;
  };
}

/** The active workspace id, or the tenant's first workspace as a fallback. */
async function resolveWorkspaceId(
  tenantId: string,
  preferredId: string | null
): Promise<string | null> {
  const supabase = await createServiceClient();
  if (preferredId) {
    const { data } = await supabase
      .from("workspaces")
      .select("id")
      .eq("id", preferredId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (data) return data.id;
  }
  const { data: first } = await supabase
    .from("workspaces")
    .select("id")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return first?.id ?? null;
}

/** /workspaces — list the tenant's workspaces with numbers to switch to. */
async function listWorkspaces(chatId: string) {
  const supabase = await createServiceClient();
  const link = await findLinkByChatId(chatId);
  if (!link) {
    await sendTelegramMessage(chatId, "You aren't connected to an app account yet.");
    return;
  }
  const { data, error } = await supabase
    .from("workspaces")
    .select("id, name")
    .eq("tenant_id", link.tenant_id)
    .order("created_at", { ascending: true });
  if (error || !data || data.length === 0) {
    await sendTelegramMessage(chatId, "No workspaces found for your account.");
    return;
  }
  const current = link.active_workspace_id;
  const lines = data.map((w, i) => {
    const mark = w.id === current ? " ✅ (current)" : "";
    return `${i + 1}. ${w.name ?? "Workspace"}${mark}`;
  });
  // One-tap inline buttons (two per row) — plus a hint for /newworkspace.
  const buttons: { text: string; callback_data: string }[][] = [];
  for (let i = 0; i < data.length; i += 2) {
    buttons.push(
      data
        .slice(i, i + 2)
        .map((w) => ({
          text: `${(w.name ?? "Workspace").slice(0, 18)}${w.id === current ? " ✓" : ""}`,
          callback_data: `ws:${w.id}`,
        }))
    );
  }
  await sendTelegramMessage(
    chatId,
    `*Your workspaces:*\n${lines.join("\n")}\n\nTap a button to switch, or /newworkspace <name> to add one.`,
    { parseMode: "Markdown", replyMarkup: { inline_keyboard: buttons } }
  );
}

/**
 * Handle an inline-button tap: `rm:<token>` = Read-more full text,
 * `ws:<id>` = switch active workspace. Fire-and-forget so the webhook
 * answers 200 fast.
 */
async function handleCallback(callbackId: string, chatId: string, data: string) {
  try {
    if (data.startsWith("rm:")) {
      const token = data.slice(3);
      await answerTelegramCallback(callbackId, "Opening full message…");
      await sendReadMoreFullText(chatId, token);
      return;
    }
    if (data.startsWith("ws:")) {
      const workspaceId = data.slice(3);
      const link = await findLinkByChatId(chatId);
      if (!link) {
        await answerTelegramCallback(callbackId, "Not connected to an app account.");
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
        await answerTelegramCallback(callbackId, "Workspace not found.");
        return;
      }
      const res = await setTelegramActiveWorkspace(chatId, workspaceId);
      if (!res.ok) {
        await answerTelegramCallback(callbackId, res.error ?? "Couldn't switch.");
        return;
      }
      await answerTelegramCallback(callbackId, `Switched to ${ws.name}.`);
      await sendTelegramMessage(
        chatId,
        `✅ Active workspace is now *${ws.name}*. New messages go to its Team Room.`,
        { parseMode: "Markdown" }
      );
      return;
    }
    await answerTelegramCallback(callbackId, "Unknown action.");
  } catch (err) {
    console.warn("[telegram] handleCallback failed:", err);
    try {
      await answerTelegramCallback(callbackId, "Couldn't process that.");
    } catch {
      // ignore
    }
  }
}

/** /workspace <n|name> — set the active workspace for this chat. */
async function selectWorkspace(chatId: string, arg: string) {
  const supabase = await createServiceClient();
  const link = await findLinkByChatId(chatId);
  if (!link) {
    await sendTelegramMessage(chatId, "You aren't connected to an app account yet.");
    return;
  }
  const { data, error } = await supabase
    .from("workspaces")
    .select("id, name")
    .eq("tenant_id", link.tenant_id)
    .order("created_at", { ascending: true });
  if (error || !data || data.length === 0) {
    await sendTelegramMessage(chatId, "No workspaces found for your account.");
    return;
  }

  let target = data[0];
  const n = Number.parseInt(arg, 10);
  if (!Number.isNaN(n) && n >= 1 && n <= data.length) {
    target = data[n - 1];
  } else {
    const byName = data.find(
      (w) => (w.name ?? "").toLowerCase() === arg.toLowerCase()
    );
    if (byName) target = byName;
    else {
      await sendTelegramMessage(
        chatId,
        `Couldn't find "${arg}". Use /workspaces to see the list.`
      );
      return;
    }
  }

  const res = await setTelegramActiveWorkspace(chatId, target.id);
  if (!res.ok) {
    await sendTelegramMessage(chatId, `❌ ${res.error ?? "Couldn't switch workspace."}`);
    return;
  }
  await sendTelegramMessage(
    chatId,
    `✅ Active workspace is now *${target.name ?? "Workspace"}*. New messages go to that workspace's Team Room.`,
    { parseMode: "Markdown" }
  );
}

/** /status — the user's 5 most recent unread notifications. */
async function replyWithStatus(chatId: string) {
  const supabase = await createServiceClient();
  const link = await findLinkByChatId(chatId);
  if (!link) {
    await sendTelegramMessage(chatId, "You aren't connected to an app account yet.");
    return;
  }
  const { data, error } = await supabase
    .from("notifications")
    .select("kind, title, body, link, created_at")
    .eq("tenant_id", link.tenant_id)
    .is("read_at", null)
    .order("created_at", { ascending: false })
    .limit(5);
  if (error || !data || data.length === 0) {
    await sendTelegramMessage(chatId, "🎉 All caught up — no unread notifications.");
    return;
  }
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://platform.blissmedialab.com";
  const emoji = { info: "ℹ️", progress: "🔄", approval: "✅", alert: "🚨" } as const;
  const lines = data.map((n, i) => {
    const kind = (n.kind ?? "info") as keyof typeof emoji;
    const link = n.link ? `\n🔗 ${site}${n.link}` : "";
    return `${i + 1}. ${emoji[kind] ?? "🔔"} ${(n.title ?? "").slice(0, 160)}${link}`;
  });
  await sendTelegramMessage(
    chatId,
    `*Unread notifications (${data.length}):*\n\n${lines.join("\n\n")}`,
    { parseMode: "Markdown" }
  );
}

/**
 * Insert the message into the user's Team Room and enqueue the normal
 * employee pipeline. Serialized per chat so replies never interleave, and
 * never awaited — the webhook returns before the LLM work starts.
 */
async function forwardToTeamRoom(input: {
  chatIdStr: string;
  tenantId: string;
  workspaceId: string | null;
  text: string;
}): Promise<void> {
  try {
    const supabase = await createServiceClient();

    // The chat's active workspace (set via /workspace), else the tenant's
    // first workspace — or null when none exist (the pipeline tolerates that).
    const workspaceId = await resolveWorkspaceId(input.tenantId, input.workspaceId);

    // Find-or-create the Team Room for that workspace.
    let { data: room } = await supabase
      .from("team_chats")
      .select("id, workspace_id, tenant_id")
      .eq("tenant_id", input.tenantId)
      .eq("workspace_id", workspaceId)
      .eq("kind", "team")
      .maybeSingle();
    if (!room) {
      const { data: created, error } = await supabase
        .from("team_chats")
        .insert({
          tenant_id: input.tenantId,
          workspace_id: workspaceId,
          client_id: null,
          title: "Team Room",
          kind: "team",
          employee_key: null,
        })
        .select("id, workspace_id, tenant_id")
        .single();
      if (error) {
        await sendTelegramMessage(
          input.chatIdStr,
          "Couldn't open your Team Room — try again in a moment."
        );
        return;
      }
      room = created;
    }

    const roomId = room.id as string;
    await enqueueOrRun({
      chatId: roomId,
      tenantId: input.tenantId,
      workspaceId: workspaceId as string | null,
      content: input.text,
      queue: (payload) => {
        // Run inline in this process (like the web app): serialized per chat.
        const prev = teamQueues.get(roomId) ?? Promise.resolve();
        const next = prev.then(
          () => processInline(payload),
          () => processInline(payload)
        );
        teamQueues.set(roomId, next);
        void next.finally(() => {
          if (teamQueues.get(roomId) === next) teamQueues.delete(roomId);
        });
        return next;
      },
    });
  } catch (err) {
    console.error("[telegram] forwardToTeamRoom failed:", err);
    await sendTelegramMessage(
      input.chatIdStr,
      "Something went wrong reaching your team — please try again."
    );
  }
}

/** Serialized inline task runner, mirroring the web app's chat behavior. */
const teamQueues = new Map<string, Promise<void>>();
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
      console.warn(`[telegram] task attempt ${i + 1}/${attempts} failed:`, err);
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 1500 * 2 ** i));
    }
  }
}
