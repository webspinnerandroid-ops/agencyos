// ============================================================================
// Discord — outbound notifications via a channel webhook URL.
//
// Discord doesn't need a bot or OAuth for *notifications*: every channel has
// a "webhook" URL (Channel Settings → Integrations → Webhooks → New Webhook),
// and POSTing a small JSON payload to it delivers a message. Set
// DISCORD_WEBHOOK_URL to enable; the same createNotification call that feeds
// the bell and Telegram also mirrors here.
//
// Two-way chat (a user messaging the server's bot) is a separate, larger
// build — it needs a Discord Application + bot token + gateway intents. This
// module only handles the outbound notification side, which is the 80% case.
// ============================================================================

const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL ?? "";

export function isDiscordConfigured(): boolean {
  return WEBHOOK_URL.trim().length > 0;
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
