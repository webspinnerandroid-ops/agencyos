import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import {
  bindTelegramChatByCode,
  getTelegramBotToken,
  sendTelegramMessage,
  unlinkTelegram,
} from "@/lib/telegram";
import { enqueueOrRun } from "@/lib/ai/team-task";

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
      from?: { id?: number; username?: string; first_name?: string };
    };
  };
  try {
    update = (await request.json()) as typeof update;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const msg = update.message;
  const chatId = msg?.chat?.id;
  if (!msg || typeof chatId !== "number") {
    return NextResponse.json({ ok: true });
  }
  const text = (msg.text ?? "").trim();
  const chatIdStr = String(chatId);

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
        "/status — your latest unread notifications\n" +
        "/unbind — disconnect this chat\n" +
        "Any other message is forwarded to your AI team (Malory & co).",
      { parseMode: "Markdown" }
    );
    return NextResponse.json({ ok: true });
  }

  if (text === "/status") {
    await replyWithStatus(chatIdStr);
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
    userId: link.user_id,
    text,
  });

  return NextResponse.json({ ok: true });
}

async function findLinkByChatId(chatId: string) {
  const supabase = await createServiceClient();
  const { data, error } = await supabase
    .from("telegram_links")
    .select("*")
    .eq("chat_id", chatId)
    .maybeSingle();
  if (error || !data) return null;
  return data as { user_id: string; tenant_id: string };
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
  userId: string;
  text: string;
}): Promise<void> {
  try {
    const supabase = await createServiceClient();

    // The tenant's first workspace (or null when none exist — the pipeline
    // tolerates that).
    const { data: workspace } = await supabase
      .from("workspaces")
      .select("id")
      .eq("tenant_id", input.tenantId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    const workspaceId = workspace?.id ?? null;

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
