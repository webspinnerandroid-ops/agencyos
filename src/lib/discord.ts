// ============================================================================
// Discord — outbound notifications + two-way bot chat.
//
// Two paths:
//   1. Notifications: every channel has a webhook URL (Channel Settings →
//      Integrations → Webhooks). POSTing an embed to it delivers a message.
//      Set DISCORD_WEBHOOK_URL to enable; createNotification mirrors there.
//   2. Two-way chat: a Discord Application + bot token (DISCORD_BOT_TOKEN).
//      A persistent gateway (src/lib/discord-gateway.ts) connects to Discord's
//      websocket, receives the user's DMs, and routes them into the AI team
//      exactly like Telegram. Replies mirror back over the bot's REST API
//      (discordSendToUser). Binding is the "Connect Discord" flow: the app
//      generates a /connect code, the user DMs the bot `/connect <code>`, and
//      the gateway records the DM channel against their user_id + tenant.
//
// Everything here is fire-and-forget: a Discord failure must never break the
// notification (or the worker) that produced it. Server-only (service role).
// ============================================================================

import { createServiceClient } from "@/lib/supabase/server";
import { randomBytes } from "crypto";

const API = "https://discord.com/api/v10";

/** A Discord action row of buttons (max 5 rows, 5 buttons per row). */
export interface DiscordActionRow {
  type: 1;
  components: {
    type: 2;
    style: 1 | 2 | 3 | 4;
    label: string;
    custom_id: string;
    disabled?: boolean;
  }[];
}

/** The bot token lives in env (DISCORD_BOT_TOKEN); null when not configured. */
export function getDiscordBotToken(): string | null {
  const token = process.env.DISCORD_BOT_TOKEN;
  return token && token.trim() ? token.trim() : null;
}

export function isDiscordBotConfigured(): boolean {
  return getDiscordBotToken() !== null;
}

const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL ?? "";

export function isDiscordConfigured(): boolean {
  return WEBHOOK_URL.trim().length > 0;
}

/** Discord REST messages cap at 2000 chars — split longer replies. */
const DISCORD_MAX_CHARS = 2000;

export function splitDiscordChunks(text: string, max = DISCORD_MAX_CHARS): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > 0) {
    if (rest.length <= max) {
      out.push(rest);
      break;
    }
    let cut = rest.lastIndexOf("\n", max - 1);
    if (cut === -1 || cut < max / 2) {
      cut = rest.lastIndexOf(" ", max - 1);
      if (cut === -1 || cut < max / 2) cut = max;
    }
    out.push(rest.slice(0, cut + 1));
    rest = rest.slice(cut + 1);
  }
  return out;
}

/**
 * Send a plain message to a Discord channel via the bot's REST API. Long text
 * is split into 2000-char chunks. Pass `components` to attach button rows.
 * Returns true on success. Never throws.
 */
export async function discordSendMessage(
  channelId: string,
  text: string,
  components?: DiscordActionRow[]
): Promise<boolean> {
  const token = getDiscordBotToken();
  if (!token || !text) return false;
  let allOk = true;
  for (const chunk of splitDiscordChunks(text)) {
    try {
      const res = await fetch(`${API}/channels/${channelId}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bot ${token}`,
        },
        body: JSON.stringify({
          content: chunk,
          ...(components ? { components } : {}),
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        console.warn(
          `[discord] sendMessage HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`
        );
        allOk = false;
        break;
      }
    } catch (err) {
      console.warn("[discord] sendMessage failed:", err);
      allOk = false;
      break;
    }
  }
  return allOk;
}

/**
 * Send a plain conversational message to every Discord DM bound to this user
 * (or the whole tenant when no user is targeted). Long replies go out as a
 * preview with a Read-more button (mirroring Telegram). Ignored when the bot
 * isn't configured. Never throws.
 */
export async function discordSendToUser(
  tenantId: string,
  userId: string | null,
  text: string
): Promise<void> {
  if (!getDiscordBotToken()) return;
  try {
    const supabase = await createServiceClient();
    let query = supabase.from("discord_links").select("channel_id").eq("tenant_id", tenantId);
    if (userId) query = query.eq("user_id", userId);
    const { data, error } = await query;
    if (error || !data || data.length === 0) return;
    for (const row of data as { channel_id: string }[]) {
      void sendLongDiscordMessage(row.channel_id, text);
    }
  } catch (err) {
    console.warn("[discord] sendToUser failed:", err);
  }
}

const KIND_COLOR: Record<string, number> = {
  info: 0x2563eb, // blue
  progress: 0xf59e0b, // amber
  approval: 0x10b981, // green
  alert: 0xef4444, // red
};

export interface DiscordNotifyInput {
  tenantId: string;
  kind: string;
  title: string;
  body?: string | null;
  link?: string | null;
}

/** Push a notification to the Discord channel. Never throws. */
export async function discordNotify(input: DiscordNotifyInput): Promise<void> {
  if (!isDiscordConfigured()) return;
  try {
    const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://platform.blissmedialab.com";
    const url = input.link
      ? `${site}${input.link.startsWith("/") ? input.link : `/${input.link}`}`
      : site;
    const embed = {
      title: input.title.slice(0, 256),
      description: (input.body ?? "").slice(0, 2000) || undefined,
      url,
      color: KIND_COLOR[input.kind] ?? KIND_COLOR.info,
      footer: { text: `Tenant ${input.tenantId}` },
      timestamp: new Date().toISOString(),
    };
    const res = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds: [embed] }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok && res.status !== 204) {
      console.warn(`[discord] webhook HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
  } catch (err) {
    console.warn("[discord] notify failed:", err);
  }
}

// ---------------------------------------------------------------------------
// Long messages + the Read-more button (mirrors the Telegram pattern).
//
// Discord messages cap at 2000 chars. Instead of silently chunking a long
// team reply into several messages, we send a preview with an inline
// "Read more…" button; tapping it delivers the full text (split into
// 2000-char chunks). The full text is cached in-process under a token in the
// button's custom_id.
// ---------------------------------------------------------------------------

const DISCORD_PREVIEW_CHARS = 1800;
const READ_MORE_TTL_MS = 24 * 60 * 60 * 1000;

/** token → { at, text } of pending long messages awaiting "Read more". */
const readMoreCache = new Map<string, { at: number; text: string }>();

/**
 * Send a conversational message that may exceed Discord's 2000-char cap.
 * Short messages go out verbatim; long ones get a preview plus a Read-more
 * button that expands to the full text. Never throws.
 */
export async function sendLongDiscordMessage(
  channelId: string,
  text: string
): Promise<boolean> {
  if (!getDiscordBotToken() || !text) return false;
  if (text.length <= DISCORD_PREVIEW_CHARS) {
    return discordSendMessage(channelId, text);
  }
  const token = randomBytes(12).toString("hex");
  readMoreCache.set(token, { at: Date.now(), text });
  const preview = splitDiscordChunks(text, DISCORD_PREVIEW_CHARS)[0] ?? text;
  const sent = await discordSendMessage(channelId, preview, [
    {
      type: 1,
      components: [
        { type: 2, style: 2, label: "📖 Read more…", custom_id: `rm:${token}` },
      ],
    },
  ]);
  if (!sent) {
    // Button delivery failed (unlikely) — fall back to plain chunks so the
    // text still arrives in full.
    readMoreCache.delete(token);
    for (const chunk of splitDiscordChunks(text)) {
      const ok = await discordSendMessage(channelId, chunk);
      if (!ok) break;
    }
  }
  return sent;
}

/** Resolve + consume a Discord Read-more token (called on the rm: callback). */
export async function consumeDiscordReadMoreToken(token: string): Promise<string | null> {
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

/** Acknowledge a message-component interaction (type 6 = DEFERRED_UPDATE_MESSAGE). */
export async function ackDiscordInteraction(
  interactionId: string,
  interactionToken: string
): Promise<void> {
  const token = getDiscordBotToken();
  if (!token) return;
  try {
    await fetch(`${API}/interactions/${interactionId}/${interactionToken}/callback`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bot ${token}`,
      },
      body: JSON.stringify({ type: 6 }),
      signal: AbortSignal.timeout(8000),
    });
  } catch (err) {
    console.warn("[discord] ack interaction failed:", err);
  }
}

/**
 * Send follow-up message(s) to an interaction via the webhook API (chunked at
 * 2000 chars). The application id + interaction token come from the event.
 */
export async function sendDiscordFollowup(
  applicationId: string,
  interactionToken: string,
  text: string
): Promise<void> {
  const token = getDiscordBotToken();
  if (!token) return;
  for (const chunk of splitDiscordChunks(text)) {
    try {
      const res = await fetch(`${API}/webhooks/${applicationId}/${interactionToken}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bot ${token}`,
        },
        body: JSON.stringify({ content: chunk }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        console.warn(
          `[discord] followup HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`
        );
        break;
      }
    } catch (err) {
      console.warn("[discord] followup failed:", err);
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Two-way bot — link codes, binding, workspace/employee selection.
// ---------------------------------------------------------------------------

/** Create a one-time /connect code for the connect flow (90 min TTL). */
export async function createDiscordLinkCode(
  userId: string,
  tenantId: string
): Promise<{ code: string; expiresAt: string } | null> {
  try {
    const supabase = await createServiceClient();
    const code = randomBytes(16).toString("hex");
    const expiresAt = new Date(Date.now() + 90 * 60 * 1000).toISOString();
    const { error } = await supabase.from("discord_link_codes").insert({
      code,
      user_id: userId,
      tenant_id: tenantId,
      expires_at: expiresAt,
    });
    if (error) {
      console.warn("[discord] createLinkCode failed:", error.message);
      return null;
    }
    return { code, expiresAt };
  } catch (err) {
    console.warn("[discord] createLinkCode failed:", err);
    return null;
  }
}

/** Bind a Discord DM (user + channel) to the user who generated `code`. */
export async function bindDiscordByCode(
  code: string,
  discordUserId: string,
  channelId: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const supabase = await createServiceClient();
    const { data: linkCode, error: fetchErr } = await supabase
      .from("discord_link_codes")
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

    const { error: upsertErr } = await supabase.from("discord_links").upsert(
      {
        user_id: linkCode.user_id,
        tenant_id: linkCode.tenant_id,
        discord_user_id: discordUserId,
        channel_id: channelId,
        bound_at: new Date().toISOString(),
      },
      { onConflict: "channel_id" }
    );
    if (upsertErr) return { ok: false, error: upsertErr.message };

    const { error: markErr } = await supabase
      .from("discord_link_codes")
      .update({ used_at: new Date().toISOString() })
      .eq("code", code);
    if (markErr) console.warn("[discord] mark code used failed:", markErr.message);

    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** The bound Discord link for this DM channel (or null). */
export async function findDiscordLinkByChannel(channelId: string): Promise<{
  user_id: string;
  tenant_id: string;
  active_workspace_id?: string | null;
  active_employee_key?: string | null;
} | null> {
  try {
    const supabase = await createServiceClient();
    const { data, error } = await supabase
      .from("discord_links")
      .select("*")
      .eq("channel_id", channelId)
      .maybeSingle();
    if (error || !data) return null;
    return data as {
      user_id: string;
      tenant_id: string;
      active_workspace_id?: string | null;
      active_employee_key?: string | null;
    };
  } catch {
    return null;
  }
}

/** Set the active workspace for a bound Discord DM. */
export async function setDiscordActiveWorkspace(
  channelId: string,
  workspaceId: string | null
): Promise<{ ok: boolean; error?: string }> {
  try {
    const supabase = await createServiceClient();
    const { error } = await supabase
      .from("discord_links")
      .update({ active_workspace_id: workspaceId })
      .eq("channel_id", channelId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Set the employee this Discord DM talks to directly (/team). null = Team Room. */
export async function setDiscordActiveEmployee(
  channelId: string,
  employeeKey: string | null
): Promise<{ ok: boolean; error?: string }> {
  try {
    const supabase = await createServiceClient();
    const { error } = await supabase
      .from("discord_links")
      .update({ active_employee_key: employeeKey })
      .eq("channel_id", channelId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Remove the user's Discord binding (disconnect). */
export async function unlinkDiscord(
  userId: string,
  tenantId: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const supabase = await createServiceClient();
    const { error } = await supabase
      .from("discord_links")
      .delete()
      .eq("user_id", userId)
      .eq("tenant_id", tenantId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
