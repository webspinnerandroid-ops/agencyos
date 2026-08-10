/**
 * In-memory sliding-window rate limiter + request helpers.
 *
 * Designed for a single-instance deployment (this app runs on one VPS).
 * Mirrors the module-level Map + TTL pattern already used in src/proxy.ts.
 * A DB-backed limiter would be needed only if the app ever scales to
 * multiple instances.
 *
 * Usage in a route handler:
 *   const rl = rateLimitRequest(request, "generate-content", 10);
 *   if (!rl.allowed) {
 *     return NextResponse.json(
 *       { error: `Rate limit exceeded. Try again in ${rl.retryAfterSeconds}s.` },
 *       { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
 *     );
 *   }
 */

const WINDOW_MS = 60_000; // all limits use a 1-minute sliding window
const MAX_BUCKETS = 10_000; // bound memory: prune when exceeded

interface Bucket {
  timestamps: number[];
}

const buckets = new Map<string, Bucket>();
let lastPrune = 0;

export interface RateLimitResult {
  allowed: boolean;
  /** Requests remaining in the current window (0 when blocked). */
  remaining: number;
  /** Seconds until the window clears; 0 when allowed. */
  retryAfterSeconds: number;
}

/**
 * Sliding-window check for `key`. Records the call when allowed.
 * `now` is injectable for tests.
 */
export function rateLimit(
  key: string,
  limit: number,
  now: number = Date.now()
): RateLimitResult {
  // Opportunistic pruning so the map never grows unbounded.
  if (now - lastPrune > WINDOW_MS || buckets.size > MAX_BUCKETS) {
    lastPrune = now;
    const cutoff = now - WINDOW_MS;
    for (const [k, bucket] of buckets) {
      bucket.timestamps = bucket.timestamps.filter((t) => t > cutoff);
      if (bucket.timestamps.length === 0) buckets.delete(k);
    }
    // If still oversized (e.g. a burst of distinct IPs), drop the newest
    // entries beyond the cap — they haven't been "spending" anyway.
    while (buckets.size > MAX_BUCKETS) {
      buckets.delete(buckets.keys().next().value as string);
    }
  }

  const cutoff = now - WINDOW_MS;
  const bucket = buckets.get(key);
  const recent = (bucket?.timestamps ?? []).filter((t) => t > cutoff);

  if (recent.length >= limit) {
    // Blocked: the oldest recent timestamp decides when the window frees up.
    const oldest = recent[0];
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + WINDOW_MS - now) / 1000));
    buckets.set(key, { timestamps: recent });
    return { allowed: false, remaining: 0, retryAfterSeconds };
  }

  recent.push(now);
  buckets.set(key, { timestamps: recent });
  return { allowed: true, remaining: limit - recent.length, retryAfterSeconds: 0 };
}

/** Best-effort client IP from proxy headers. */
export function getClientIp(request: { headers: Headers }): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip") ?? "unknown";
}

/**
 * Rate-limit a request, keyed by authenticated user id when available
 * (via the middleware's x-user-id cookie) and falling back to client IP.
 */
export function rateLimitRequest(
  request: {
    cookies: { get(name: string): { value?: string } | undefined };
    headers: Headers;
  },
  prefix: string,
  limit: number,
  now?: number
): RateLimitResult {
  const userId = request.cookies.get("x-user-id")?.value;
  const key = userId
    ? `${prefix}:user:${userId}`
    : `${prefix}:ip:${getClientIp(request)}`;
  return rateLimit(key, limit, now);
}
