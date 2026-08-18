"use server";

import { createServiceClient } from "@/lib/supabase/server";
import { getUserId, getTenantId } from "@/lib/auth";
import {
  createDiscordLinkCode,
  discordSendMessage,
  getDiscordBotToken,
  isDiscordBotConfigured,
  unlinkDiscord,
} from "@/lib/discord";

export interface DiscordStatus {
  configured: boolean;
  botUsername: string | null;
  connected: boolean;
  channelMasked: string | null;
}

/** Whether Discord is set up at all + this user's link state. */
export async function getDiscordStatus(): Promise<{
  success: boolean;
  data?: DiscordStatus;
  error?: string;
}> {
  try {
    const userId = await getUserId();
    const tenantId = await getTenantId();
    if (!userId) return { success: false, error: "Not signed in" };

    const configured = isDiscordBotConfigured();
    let connected = false;
    let channelMasked: string | null = null;
    if (configured) {
      const supabase = await createServiceClient();
      const { data } = await supabase
        .from("discord_links")
        .select("channel_id")
        .eq("user_id", userId)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      connected = !!data;
      channelMasked = data
        ? `${data.channel_id.slice(0, 3)}…${data.channel_id.slice(-4)}`
        : null;
    }

    return {
      success: true,
      data: {
        configured,
        botUsername: process.env.DISCORD_BOT_USERNAME ?? null,
        connected,
        channelMasked,
      },
    };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/** Generate a one-time /connect code for the Discord bind flow. */
export async function startDiscordConnect(): Promise<{
  success: boolean;
  data?: { code: string; expiresAt: string };
  error?: string;
}> {
  try {
    const userId = await getUserId();
    const tenantId = await getTenantId();
    if (!userId) return { success: false, error: "Not signed in" };
    if (!isDiscordBotConfigured()) {
      return { success: false, error: "Discord isn't configured on this server yet." };
    }
    const created = await createDiscordLinkCode(userId, tenantId);
    if (!created) return { success: false, error: "Couldn't create a link code." };
    return { success: true, data: { code: created.code, expiresAt: created.expiresAt } };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/** Disconnect the user's Discord DM from this tenant. */
export async function disconnectDiscord(): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const userId = await getUserId();
    const tenantId = await getTenantId();
    if (!userId) return { success: false, error: "Not signed in" };
    const res = await unlinkDiscord(userId, tenantId);
    return { success: res.ok, error: res.error };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/** Send a test message to the user's bound Discord DM (proves the bot). */
export async function sendDiscordTest(): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const userId = await getUserId();
    const tenantId = await getTenantId();
    if (!userId) return { success: false, error: "Not signed in" };
    if (!getDiscordBotToken()) return { success: false, error: "Discord isn't configured." };
    const supabase = await createServiceClient();
    const { data } = await supabase
      .from("discord_links")
      .select("channel_id")
      .eq("user_id", userId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!data) return { success: false, error: "Connect Discord first." };
    await discordSendMessage(
      data.channel_id,
      "✅ **Discord test** — if you can read this in your DM, the bot bridge is working."
    );
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}
