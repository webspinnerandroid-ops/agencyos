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
 * notification burst. Never throws.
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
      void sendTelegramMessage(row.chat_id, text);
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
  opts: { parseMode?: "HTML" | "Markdown" } = {}
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
        allowed_updates: ["message"],
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
