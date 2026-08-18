// ============================================================================
// Discord gateway — the persistent websocket transport for two-way chat.
//
// Discord does NOT push DMs to an HTTP endpoint for normal bots; a bot must
// hold an open connection to the Discord Gateway (a websocket) and receive
// events. This module maintains that connection for the life of the Next.js
// server: heartbeat, resume-on-reconnect, and forwarding every inbound DM to
// the internal /api/discord/webhook route (the "brain", which is identical in
// spirit to the Telegram webhook).
//
// It is dormant unless DISCORD_BOT_TOKEN is set, and it guards against being
// started twice (Next dev can import server modules from multiple contexts).
//
// Gateway protocol (v10): OP 10 Hello → heartbeat loop; OP 2 Identify; events
// arrive as OP 0 Dispatch; OP 7 Reconnect / OP 9 Invalid Session drive the
// resume logic. Intents: DIRECT_MESSAGES (1<<12) to receive DMs and
// MESSAGE_CONTENT (1<<15, privileged) to read their text.
// ============================================================================

import { getDiscordBotToken } from "@/lib/discord";

const GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";
const OP = {
  DISPATCH: 0,
  HEARTBEAT: 1,
  IDENTIFY: 2,
  RESUME: 6,
  RECONNECT: 7,
  INVALID_SESSION: 9,
  HELLO: 10,
  HEARTBEAT_ACK: 11,
} as const;

const INTENT_DIRECT_MESSAGES = 1 << 12;
const INTENT_MESSAGE_CONTENT = 1 << 15;
const INTENTS = INTENT_DIRECT_MESSAGES | INTENT_MESSAGE_CONTENT;

let started = false;
let ws: WebSocket | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let heartbeatAck = true;
let seq: number | null = null;
let sessionId: string | null = null;
let botUserId: string | null = null;
let reconnectAttempts = 0;
let forceReconnect = false;

/** The internal secret the gateway sends to /api/discord/webhook. */
function internalSecret(): string {
  const explicit = process.env.DISCORD_INTERNAL_SECRET;
  if (explicit && explicit.trim()) return explicit.trim();
  return `dg_${(getDiscordBotToken() ?? "").slice(-24)}`;
}

/** POST an inbound DM to the internal webhook route (fire-and-forget). */
async function forwardToRoute(authorId: string, channelId: string, text: string): Promise<void> {
  try {
    const port = process.env.PORT ?? "3000";
    const base = `http://127.0.0.1:${port}`;
    await fetch(`${base}/api/discord/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": internalSecret(),
      },
      body: JSON.stringify({ authorId, channelId, text }),
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    console.warn("[discord-gateway] forward failed:", err);
  }
}

function clearHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function startHeartbeat(intervalMs: number) {
  clearHeartbeat();
  heartbeatAck = true;
  heartbeatTimer = setInterval(() => {
    if (!heartbeatAck) {
      // Missed an ACK — the connection is dead; force a reconnect.
      console.warn("[discord-gateway] heartbeat ACK missed — reconnecting");
      if (ws) {
        try {
          ws.close(4000, "heartbeat timeout");
        } catch {
          // ignore
        }
      }
      return;
    }
    heartbeatAck = false;
    send({ op: OP.HEARTBEAT, d: seq });
  }, intervalMs);
}

function send(payload: unknown) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function identify() {
  send({
    op: OP.IDENTIFY,
    d: {
      token: getDiscordBotToken(),
      intents: INTENTS,
      properties: {
        os: process.platform,
        browser: "agencyos",
        device: "agencyos",
      },
      compress: false,
    },
  });
}

function resume() {
  send({
    op: OP.RESUME,
    d: {
      token: getDiscordBotToken(),
      session_id: sessionId,
      seq,
    },
  });
}

function handleDispatch(t: string, d: unknown) {
  if (t === "READY") {
    const ready = d as { session_id?: string; user?: { id?: string } };
    sessionId = ready.session_id ?? null;
    botUserId = ready.user?.id ?? null;
    reconnectAttempts = 0;
    console.log("[discord-gateway] connected as", botUserId ?? "?");
    return;
  }
  if (t === "RESUMED") {
    reconnectAttempts = 0;
    console.log("[discord-gateway] resumed session");
    return;
  }
  if (t === "MESSAGE_CREATE") {
    const msg = d as {
      id?: string;
      channel_id?: string;
      author?: { id?: string; bot?: boolean };
      content?: string;
      channel_type?: number;
    };
    // Only DMs (channel_type 1), never our own messages, never empty.
    if (msg.channel_type !== 1) return;
    if (msg.author?.bot) return;
    if (msg.author?.id === botUserId) return;
    const text = (msg.content ?? "").trim();
    if (!text || !msg.channel_id || !msg.author?.id) return;
    void forwardToRoute(msg.author.id, msg.channel_id, text);
  }
}

function handleMessage(raw: string) {
  let json: { op?: number; s?: number | null; t?: string | null; d?: unknown };
  try {
    json = JSON.parse(raw) as typeof json;
  } catch {
    return;
  }
  if (typeof json.s === "number") seq = json.s;

  switch (json.op) {
    case OP.HELLO: {
      const hello = json.d as { heartbeat_interval?: number };
      startHeartbeat(hello.heartbeat_interval ?? 41250);
      if (sessionId && !forceReconnect) {
        resume();
      } else {
        identify();
      }
      break;
    }
    case OP.HEARTBEAT_ACK:
      heartbeatAck = true;
      break;
    case OP.DISPATCH:
      if (json.t) handleDispatch(json.t, json.d);
      break;
    case OP.RECONNECT:
      reconnect();
      break;
    case OP.INVALID_SESSION: {
      const canResume = json.d === true;
      clearHeartbeat();
      if (canResume && sessionId) {
        resume();
      } else {
        sessionId = null;
        forceReconnect = false;
        identify();
      }
      break;
    }
    default:
      break;
  }
}

function reconnect() {
  clearHeartbeat();
  if (ws) {
    try {
      ws.close(4000, "reconnect");
    } catch {
      // ignore
    }
  }
}

function connect() {
  if (!getDiscordBotToken()) return;
  try {
    ws = new WebSocket(GATEWAY_URL);
  } catch (err) {
    console.warn("[discord-gateway] socket open failed:", err);
    scheduleReconnect();
    return;
  }

  ws.addEventListener("open", () => {
    console.log("[discord-gateway] socket open");
  });

  ws.addEventListener("message", (ev) => {
    const data = ev.data;
    if (typeof data === "string") {
      handleMessage(data);
    } else if (data instanceof ArrayBuffer) {
      handleMessage(Buffer.from(data).toString("utf8"));
    } else if (data && typeof (data as { text?: unknown }).text === "function") {
      void (data as { text: () => Promise<string> })
        .text()
        .then(handleMessage)
        .catch(() => undefined);
    }
  });

  const onClose = () => {
    clearHeartbeat();
    ws = null;
    scheduleReconnect();
  };
  ws.addEventListener("close", onClose);
  ws.addEventListener("error", () => {
    // The close event follows and triggers the reconnect.
  });
}

function scheduleReconnect() {
  if (!forceReconnect && !getDiscordBotToken()) return;
  reconnectAttempts += 1;
  const delay = Math.min(30000, 1000 * 2 ** Math.min(reconnectAttempts, 5));
  console.log(`[discord-gateway] reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);
  setTimeout(() => {
    if (forceReconnect) {
      forceReconnect = false;
      sessionId = null;
    }
    connect();
  }, delay);
}

/** Start the gateway once. Safe to call repeatedly; no-op unless configured. */
export function startDiscordGateway(): void {
  if (started) return;
  if (!getDiscordBotToken()) {
    console.log("[discord-gateway] DISCORD_BOT_TOKEN not set — two-way Discord disabled");
    return;
  }
  started = true;
  console.log("[discord-gateway] starting");
  connect();
}
