// ============================================================================
// instrumentation.ts — server-boot hooks (Next 15+).
//
// register() runs once when the Node server starts. We use it to start the
// persistent Discord gateway (two-way bot chat). It's a no-op when
// DISCORD_BOT_TOKEN isn't set, so the app runs unchanged without Discord.
//
// Next also evaluates this file for the edge runtime; the gateway uses Node
// APIs (crypto, WebSocket, process), so it must only ever load under the
// Node.js runtime — otherwise the edge bundle tries to resolve it and fails.
// ============================================================================

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startDiscordGateway } = await import("@/lib/discord-gateway");
  startDiscordGateway();
}
