// ============================================================================
// instrumentation.ts — server-boot hooks (Next 15+).
//
// register() runs once when the Node server starts. We use it to start the
// persistent Discord gateway (two-way bot chat). It's a no-op when
// DISCORD_BOT_TOKEN isn't set, so the app runs unchanged without Discord.
// ============================================================================

export async function register() {
  const { startDiscordGateway } = await import("@/lib/discord-gateway");
  startDiscordGateway();
}
