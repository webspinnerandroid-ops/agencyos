"use server";

import { createServiceClient } from "@/lib/supabase/server";
import { getUserId, getTenantId } from "@/lib/auth";
import {
  createTelegramLinkCode,
  getTelegramBotInfo,
  getTelegramLink,
  isTelegramConfigured,
  setTelegramAlertOnly as setLinkAlertOnly,
  unlinkTelegram,
} from "@/lib/telegram";

export interface TelegramStatus {
  configured: boolean;
  botUsername: string | null;
  connected: boolean;
  chatMasked: string | null;
  alertOnly: boolean;
}

/** Whether Telegram is set up at all + this user's link state. */
export async function getTelegramStatus(): Promise<{
  success: boolean;
  data?: TelegramStatus;
  error?: string;
}> {
  try {
    const userId = await getUserId();
    const tenantId = await getTenantId();
    if (!userId) return { success: false, error: "Not signed in" };

    const configured = isTelegramConfigured();
    const info = configured ? await getTelegramBotInfo() : null;
    const link = configured ? await getTelegramLink(userId, tenantId) : null;

    return {
      success: true,
      data: {
        configured,
        botUsername: info?.username ?? null,
        connected: !!link,
        chatMasked: link
          ? `${link.chat_id.slice(0, 3)}…${link.chat_id.slice(-4)}`
          : null,
        alertOnly: link?.alert_only ?? false,
      },
    };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/** Generate a one-time /start code + the t.me link the user must tap. */
export async function startTelegramConnect(): Promise<{
  success: boolean;
  data?: { code: string; link: string; expiresAt: string };
  error?: string;
}> {
  try {
    const userId = await getUserId();
    const tenantId = await getTenantId();
    if (!userId) return { success: false, error: "Not signed in" };
    if (!isTelegramConfigured()) {
      return { success: false, error: "Telegram isn't configured on this server yet." };
    }

    const created = await createTelegramLinkCode(userId, tenantId);
    if (!created) return { success: false, error: "Couldn't create a link code." };

    const info = await getTelegramBotInfo();
    const bot = info?.username;
    if (!bot) return { success: false, error: "Couldn't reach the Telegram bot." };

    return {
      success: true,
      data: {
        code: created.code,
        link: `https://t.me/${bot}?start=${created.code}`,
        expiresAt: created.expiresAt,
      },
    };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/** Disconnect the user's Telegram chat from this tenant. */
export async function disconnectTelegram(): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const userId = await getUserId();
    const tenantId = await getTenantId();
    if (!userId) return { success: false, error: "Not signed in" };
    const res = await unlinkTelegram(userId, tenantId);
    return { success: res.ok, error: res.error };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/** Toggle alert-only mode (approval + alert kinds only). */
export async function setTelegramAlertOnly(
  alertOnly: boolean
): Promise<{ success: boolean; error?: string }> {
  try {
    const userId = await getUserId();
    const tenantId = await getTenantId();
    if (!userId) return { success: false, error: "Not signed in" };
    const res = await setLinkAlertOnly(userId, tenantId, alertOnly);
    return { success: res.ok, error: res.error };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/** Publish a test notification to the user's phone (kills two birds: proves
 * the bridge AND gives a real unread notification). */
export async function sendTelegramTest(): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const userId = await getUserId();
    const tenantId = await getTenantId();
    if (!userId) return { success: false, error: "Not signed in" };
    const supabase = await createServiceClient();
    const { error } = await supabase.from("notifications").insert({
      tenant_id: tenantId,
      user_id: userId,
      kind: "info",
      title: "Telegram test",
      body: "If you can read this on your phone, the Telegram bridge is working.",
      link: "/dashboard",
    });
    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}
