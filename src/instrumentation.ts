// ============================================================================
// instrumentation.ts — server-boot hooks (Next 15+).
//
// register() runs once when the Node server starts. It does two things:
//
// 1. Installs a global undici dispatcher with hard transport timeouts. This
//    is the last line of defense for EVERY outbound fetch in the app —
//    including SDK-internal calls and libs not individually wrapped — so a
//    wedged upstream (Supabase, Stripe, Discord, a social API, an email
//    provider…) can never hang a request forever. During the VPS egress
//    blips this used to let inngest jobs and API routes pile up unbounded
//    pending sockets until the server stopped accepting connections.
//
// 2. Starts the persistent Discord gateway (two-way bot chat). It's a no-op
//    when DISCORD_BOT_TOKEN isn't set, so the app runs unchanged without
//    Discord.
//
// Next also evaluates this file for the edge runtime; the gateway and the
// undici agent use Node APIs, so they must only ever load under the Node.js
// runtime — otherwise the edge bundle tries to resolve them and fails.
// ============================================================================

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { Agent, setGlobalDispatcher } = await import("undici");
  setGlobalDispatcher(
    new Agent({
      // TCP connect must complete fast on a local/upstream socket.
      connect: { timeout: 10_000 },
      // A connected upstream must send response headers within 30s.
      headersTimeout: 30_000,
      // A response body must finish within 120s (covers long generations).
      bodyTimeout: 120_000,
      // Cap concurrent connections per origin so a burst of stuck sockets
      // can't exhaust the process.
      connections: 128,
    })
  );

  const { startDiscordGateway } = await import("@/lib/discord-gateway");
  startDiscordGateway();

  // 3. Background job sweepers (in-process durability for this long-lived
  // Node deployment; the Inngest crons drive the same seams on serverless):
  //    - hold processor: resolves expired 15-minute auto-publish holds
  //    - retry processor: retries failed publishes on a backoff ladder
  // Starting them here (not on first route import) guarantees a hold armed
  // right after boot is resolved even before any matching route is hit.
  const { startHoldProcessor } = await import("@/lib/content-map-autopublish");
  startHoldProcessor();
  const { startRetryProcessor } = await import(
    "@/lib/publishing/retryFailedPublishes"
  );
  startRetryProcessor();
}
