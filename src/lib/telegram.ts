// ============================================================================
// Telegram — outbound notifications + the webhook link flow.
//
// A Telegram bot mirrors in-app notifications to the user's phone and answers
// simple commands from the chat (status, unread, help). Binding is the
// "Connect Telegram" flow: the app generates a one-time /start code, the user
// taps t.me/<bot>?start=CODE in Telegram, and the webhook consumes the code
// and records the chat_id against their user_id + tenant.
//
// Everything here is fire-and-forget: a Telegram failure must never break the
// notification (or the worker) that produced it. Only server code calls these
// (service role client).
// ============================================================================

import { createServiceClient } from "@/lib/supabase/server";
import { randomBytes } from "crypto";

export interface TelegramLinkRow {
  id: string;
  user_id: string;
  tenant_id: string;
  chat_id: string;
  bot_username: string | null;
  alert_only: boolean;
  bound_at: string | null;
  created_at: string;
}

/** The bot token lives in env (TELEGRAM_BOT_TOKEN); null when not configured. */
export function getTelegramBotToken(): string | null {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  return token && token.trim() ? token.trim() : null;
}

export function isTelegramConfigured(): boolean {
  return getTelegramBotToken() !== null;
}

/**
 * The webhook secret Telegram must send back on every update. When
 * TELEGRAM_WEBHOOK_SECRET is unset we derive a stable secret from the bot
 * token itself so the hook is still protected without extra config.
 */
export function getTelegramWebhookSecret(): string {
  const explicit = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (explicit && explicit.trim()) return explicit.trim();
  const token = getTelegramBotToken();
  return token ? `wb_${token.slice(-24)}` : "wb_unset";
}

/** Resolve a Telegram file_id → direct download URL (for photo uploads). */
export async function getTelegramFileUrl(fileId: string): Promise<string | null> {
  const token = getTelegramBotToken();
  if (!token) return null;
  try {
    const res = await fetch(`${API}/bot${token}/getFile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_id: fileId }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { ok?: boolean; result?: { file_path?: string } };
    const path = json.result?.file_path;
    if (json.ok !== true || !path) return null;
    return `${API}/file/bot${token}/${path}`;
  } catch {
    return null;
  }
}

/**
 * Send a plain conversational message to every Telegram chat bound to this
 * user (or the whole tenant when no user is targeted). Unlike telegramNotify,
 * this ignores alert-only mode — a direct chat reply is a conversation, not a
 * notification burst. Long replies are delivered in full (preview + a
 * Read-more button above Telegram's 4096-char cap). Never throws.
 */
export async function telegramSendToUser(
  tenantId: string,
  userId: string | null,
  text: string
): Promise<void> {
  if (!getTelegramBotToken()) return;
  try {
    const supabase = await createServiceClient();
    let query = supabase.from("telegram_links").select("chat_id").eq("tenant_id", tenantId);
    if (userId) query = query.eq("user_id", userId);
    const { data, error } = await query;
    if (error || !data || data.length === 0) return;
    for (const row of data as { chat_id: string }[]) {
      void sendLongTelegramMessage(row.chat_id, text);
    }
  } catch (err) {
    console.warn("[telegram] sendToUser failed:", err);
  }
}

/** getMe — the bot's username, needed for the t.me/<bot>?start=CODE link. */
export async function getTelegramBotInfo(): Promise<{
  username: string | null;
  firstName: string | null;
} | null> {
  const token = getTelegramBotToken();
  if (!token) return null;
  try {
    const res = await fetch(`${API}/bot${token}/getMe`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      ok?: boolean;
      result?: { username?: string; first_name?: string };
    };
    if (json.ok !== true || !json.result) return null;
    return {
      username: json.result.username ?? null,
      firstName: json.result.first_name ?? null,
    };
  } catch {
    return null;
  }
}

const API = "https://api.telegram.org";

/** Best-effort sendMessage. Returns true on a 200 with ok:true. */
export async function sendTelegramMessage(
  chatId: string,
  text: string,
  opts: {
    parseMode?: "HTML" | "Markdown";
    replyMarkup?: { inline_keyboard: { text: string; callback_data: string }[][] };
  } = {}
): Promise<boolean> {
  const token = getTelegramBotToken();
  if (!token) return false;
  try {
    const res = await fetch(`${API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        ...(opts.parseMode ? { parse_mode: opts.parseMode } : {}),
        ...(opts.replyMarkup ? { reply_markup: opts.replyMarkup } : {}),
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      console.warn(
        `[telegram] sendMessage HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`
      );
      return false;
    }
    const json = (await res.json()) as { ok?: boolean };
    return json.ok === true;
  } catch (err) {
    console.warn("[telegram] sendMessage failed:", err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Long messages + the Read-more button.
//
// Telegram's sendMessage caps at 4096 characters. Team replies can be far
// longer (full blog drafts, campaign plans), so instead of silently
// truncating we send a preview with an inline "Read more" button; tapping it
// delivers the full text (split into 4096-char chunks if needed). The full
// text is cached in-process with a token in the callback payload.
// ---------------------------------------------------------------------------

const TELEGRAM_MAX_CHARS = 4096;
const TELEGRAM_PREVIEW_CHARS = 3800;
const READ_MORE_TTL_MS = 24 * 60 * 60 * 1000;

/** token → { at, text } of pending long messages awaiting "Read more". */
const readMoreCache = new Map<string, { at: number; text: string }>();

/** Split arbitrary text into Telegram-sized chunks (<= 4096 chars). */
export function splitTelegramChunks(text: string, max = TELEGRAM_MAX_CHARS): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > 0) {
    if (rest.length <= max) {
      out.push(rest);
      break;
    }
    // Cut at the last newline/space boundary inside the limit so words are
    // never split mid-way.
    let cut = rest.lastIndexOf("\n", max - 1);
    if (cut === -1 || cut < max / 2) {
      // No newline boundary — fall back to a space boundary.
      cut = rest.lastIndexOf(" ", max - 1);
      if (cut === -1 || cut < max / 2) cut = max;
    }
    out.push(rest.slice(0, cut + 1));
    rest = rest.slice(cut + 1);
  }
  return out;
}

/**
 * Send a conversational message that may exceed Telegram's 4096-char cap.
 * Short messages go out verbatim; long ones get a preview plus a Read-more
 * button that expands to the full text. Never throws.
 */
export async function sendLongTelegramMessage(
  chatId: string,
  text: string
): Promise<boolean> {
  if (!getTelegramBotToken()) return false;
  if (!text) return false;
  // Short enough — send as one message.
  if (text.length <= TELEGRAM_PREVIEW_CHARS) {
    return sendTelegramMessage(chatId, text);
  }
  // Long: preview + Read-more button. The full text is cached under a random
  // token; the webhook resolves it when the button is tapped.
  const token = randomBytes(12).toString("hex");
  readMoreCache.set(token, { at: Date.now(), text });
  const preview = splitTelegramChunks(text, TELEGRAM_PREVIEW_CHARS)[0] ?? text;
  const sent = await sendTelegramMessage(chatId, preview, {
    replyMarkup: {
      inline_keyboard: [
        [{ text: "📖 Read more…", callback_data: `rm:${token}` }],
      ],
    },
  });
  if (!sent) {
    // Button delivery failed (unlikely) — fall back to plain chunks so the
    // text still arrives in full.
    readMoreCache.delete(token);
    for (const chunk of splitTelegramChunks(text)) {
      const ok = await sendTelegramMessage(chatId, chunk);
      if (!ok) break;
    }
  }
  return sent;
}

/** Resolve + consume a Read-more token (called on the rm:<token> callback). */
export async function consumeReadMoreToken(token: string): Promise<string | null> {
  if (!token) return null;
  const entry = readMoreCache.get(token);
  if (!entry) return null;
  if (Date.now() - entry.at > READ_MORE_TTL_MS) {
    readMoreCache.delete(token);
    return null;
  }
  readMoreCache.delete(token);
  return entry.text;
}

/**
 * Send the full (possibly chunked) text that a Read-more button requested.
 * Never throws.
 */
export async function sendReadMoreFullText(
  chatId: string,
  token: string
): Promise<boolean> {
  try {
    const full = await consumeReadMoreToken(token);
    if (!full) {
      return sendTelegramMessage(
        chatId,
        "That full message is no longer cached — ask again and I'll resend it in one piece."
      );
    }
    for (const chunk of splitTelegramChunks(full)) {
      const ok = await sendTelegramMessage(chatId, chunk);
      if (!ok) break;
    }
    return true;
  } catch (err) {
    console.warn("[telegram] readMore failed:", err);
    return false;
  }
}

/** Reply to a Telegram callback_query (ends the button's loading spinner). */
export async function answerTelegramCallback(
  callbackQueryId: string,
  text?: string
): Promise<void> {
  const token = getTelegramBotToken();
  if (!token) return;
  try {
    await fetch(`${API}/bot${token}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        ...(text ? { text: text.slice(0, 200) } : {}),
      }),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    // The button spinner will simply keep spinning briefly — not fatal.
  }
}

/**
 * Create a workspace for a tenant from the Telegram interface
 * (/newworkspace <name>). Mirrors the in-app limits: license max_workspaces
 * cap, slug generation, first-workspace brand profile.
 */
export async function telegramCreateWorkspace(
  tenantId: string,
  name: string
): Promise<{ ok: boolean; workspace?: { id: string; name: string }; error?: string }> {
  try {
    const supabase = await createServiceClient();
    const clean = name.trim().replace(/\s+/g, " ").slice(0, 80);
    if (!clean) return { ok: false, error: "Give the workspace a name, e.g. /newworkspace Acme Corp" };
    const slug = clean.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (!slug) return { ok: false, error: "Workspace name needs at least one letter or number." };

    const { count } = await supabase
      .from("workspaces")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId);
    const { data: license } = await supabase
      .from("licenses")
      .select("limits")
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .maybeSingle();
    const limits = (license?.limits as Record<string, unknown> | null) ?? null;
    const maxWorkspaces =
      typeof limits?.max_workspaces === "number" ? (limits.max_workspaces as number) : 1;
    if ((count ?? 0) >= maxWorkspaces) {
      return {
        ok: false,
        error: `Workspace limit reached (${maxWorkspaces}). You can raise it under Admin → Plans, then try again.`,
      };
    }

    const { data, error } = await supabase
      .from("workspaces")
      .insert({
        tenant_id: tenantId,
        name: clean,
        slug,
        description: "Created from Telegram",
        is_default: (count ?? 0) === 0,
      })
      .select("id, name")
      .single();
    if (error) return { ok: false, error: error.message };

    if ((count ?? 0) === 0) {
      await supabase.from("brand_profiles").insert({
        workspace_id: data.id,
        tenant_id: tenantId,
        name: "Default Brand Profile",
        is_default: true,
      });
    }
    return { ok: true, workspace: { id: data.id, name: data.name } };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Register the app's public webhook URL on the bot (idempotent). */
export async function setTelegramWebhook(
  webhookUrl: string,
  secretToken: string
): Promise<{ ok: boolean; description?: string }> {
  const token = getTelegramBotToken();
  if (!token) return { ok: false, description: "TELEGRAM_BOT_TOKEN not set" };
  try {
    const res = await fetch(`${API}/bot${token}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: webhookUrl,
        secret_token: secretToken,
        allowed_updates: ["message", "callback_query"],
        drop_pending_updates: true,
      }),
      signal: AbortSignal.timeout(10000),
    });
    const json = (await res.json()) as { ok?: boolean; description?: string };
    return { ok: json.ok === true, description: json.description };
  } catch (err) {
    return { ok: false, description: (err as Error).message };
  }
}

/** Create a one-time /start code for the connect flow (90 min TTL). */
export async function createTelegramLinkCode(
  userId: string,
  tenantId: string
): Promise<{ code: string; expiresAt: string } | null> {
  try {
    const supabase = await createServiceClient();
    const code = randomBytes(16).toString("hex");
    const expiresAt = new Date(Date.now() + 90 * 60 * 1000).toISOString();
    const { error } = await supabase.from("telegram_link_codes").insert({
      code,
      user_id: userId,
      tenant_id: tenantId,
      expires_at: expiresAt,
    });
    if (error) {
      console.warn("[telegram] createLinkCode failed:", error.message);
      return null;
    }
    return { code, expiresAt };
  } catch (err) {
    console.warn("[telegram] createLinkCode failed:", err);
    return null;
  }
}

/** The user's bound Telegram link for this tenant (or null). */
export async function getTelegramLink(
  userId: string,
  tenantId: string
): Promise<TelegramLinkRow | null> {
  try {
    const supabase = await createServiceClient();
    const { data, error } = await supabase
      .from("telegram_links")
      .select("*")
      .eq("user_id", userId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) {
      console.warn("[telegram] getLink failed:", error.message);
      return null;
    }
    return (data as TelegramLinkRow) ?? null;
  } catch (err) {
    console.warn("[telegram] getLink failed:", err);
    return null;
  }
}

/** Bind a chat_id to the user who generated `code` (called by the webhook). */
export async function bindTelegramChatByCode(
  code: string,
  chatId: string,
  botUsername: string | null
): Promise<{ ok: boolean; error?: string }> {
  try {
    const supabase = await createServiceClient();
    const { data: linkCode, error: fetchErr } = await supabase
      .from("telegram_link_codes")
      .select("*")
      .eq("code", code)
      .maybeSingle();
    if (fetchErr) return { ok: false, error: fetchErr.message };
    if (!linkCode) return { ok: false, error: "Unknown or expired link code." };
    if (new Date(linkCode.expires_at) < new Date()) {
      return { ok: false, error: "That link expired — generate a new one in the app." };
    }
    if (linkCode.used_at) {
      return { ok: false, error: "That link was already used." };
    }

    // Upsert the link: the same chat can be re-bound to the same user.
    const { error: upsertErr } = await supabase.from("telegram_links").upsert(
      {
        user_id: linkCode.user_id,
        tenant_id: linkCode.tenant_id,
        chat_id: chatId,
        bot_username: botUsername,
        alert_only: false,
        bound_at: new Date().toISOString(),
      },
      { onConflict: "chat_id" }
    );
    if (upsertErr) return { ok: false, error: upsertErr.message };

    const { error: markErr } = await supabase
      .from("telegram_link_codes")
      .update({ used_at: new Date().toISOString() })
      .eq("code", code);
    if (markErr) console.warn("[telegram] mark code used failed:", markErr.message);

    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Set the active workspace for a bound Telegram chat. */
export async function setTelegramActiveWorkspace(
  chatId: string,
  workspaceId: string | null
): Promise<{ ok: boolean; error?: string }> {
  try {
    const supabase = await createServiceClient();
    const { error } = await supabase
      .from("telegram_links")
      .update({ active_workspace_id: workspaceId })
      .eq("chat_id", chatId);
    if (error) {
      // Column not applied yet (migration 080 pending) — fail with a clear message.
      if (/active_workspace_id/.test(error.message)) {
        return { ok: false, error: "Workspace selection isn't enabled yet — apply migration 080." };
      }
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Remove the user's Telegram binding (disconnect). */
export async function unlinkTelegram(
  userId: string,
  tenantId: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const supabase = await createServiceClient();
    const { error } = await supabase
      .from("telegram_links")
      .delete()
      .eq("user_id", userId)
      .eq("tenant_id", tenantId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Toggle alert-only mode (only approval + alert notifications push). */
export async function setTelegramAlertOnly(
  userId: string,
  tenantId: string,
  alertOnly: boolean
): Promise<{ ok: boolean; error?: string }> {
  try {
    const supabase = await createServiceClient();
    const { error } = await supabase
      .from("telegram_links")
      .update({ alert_only: alertOnly })
      .eq("user_id", userId)
      .eq("tenant_id", tenantId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// ---------------------------------------------------------------------------
// Notification bridge — called (fire-and-forget) from createNotification so
// every bell notification mirrors to the user's phone when a bot is set up.
// ---------------------------------------------------------------------------

const KIND_EMOJI: Record<string, string> = {
  info: "ℹ️",
  progress: "🔄",
  approval: "✅",
  alert: "🚨",
};

export interface TelegramNotifyInput {
  tenantId: string;
  userId?: string | null;
  kind: string;
  title: string;
  body?: string | null;
  link?: string | null;
}

/**
 * Push a notification to every Telegram chat bound to this user (or to the
 * tenant when no user is targeted). Never throws; alert_only links only
 * receive approval/alert kinds.
 */
export async function telegramNotify(input: TelegramNotifyInput): Promise<void> {
  const token = getTelegramBotToken();
  if (!token) return;
  try {
    const supabase = await createServiceClient();
    let query = supabase.from("telegram_links").select("*").eq("tenant_id", input.tenantId);
    if (input.userId) query = query.eq("user_id", input.userId);
    const { data, error } = await query;
    if (error || !data || data.length === 0) return;

    const emoji = KIND_EMOJI[input.kind] ?? "🔔";
    const headline = input.title.slice(0, 200);
    const body = (input.body ?? "").slice(0, 600);
    const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://platform.blissmedialab.com";
    const linkLine = input.link
      ? `\n🔗 ${site}${input.link.startsWith("/") ? input.link : `/${input.link}`}`
      : "";

    for (const row of data as TelegramLinkRow[]) {
      if (row.alert_only && input.kind !== "approval" && input.kind !== "alert") continue;
      const text = `${emoji} *${headline}*${body ? `\n${body}` : ""}${linkLine}`;
      // Fire each send independently; never block the caller.
      void sendTelegramMessage(row.chat_id, text, { parseMode: "Markdown" });
    }
  } catch (err) {
    console.warn("[telegram] notify failed:", err);
  }
}
