/**
 * Make.com publishing relay.
 *
 * The no-app-review path to Facebook, Instagram, LinkedIn, TikTok, Threads,
 * and Reddit publishing: instead of each tenant walking Meta's App Review /
 * Business Verification for direct API publish permissions, the tenant
 * pastes ONE Make.com webhook URL (their own Make scenario — Make's
 * pre-approved Meta app does the platform-side auth). The social publisher
 * then POSTs a JSON payload per platform target:
 *
 *   {
 *     platform:       "facebook" | "instagram" | "linkedin" | "tiktok"
 *                   | "threads" | "reddit" | "pinterest",
 *     caption:        string,          // the post text
 *     mediaUrls:      string[],        // public image/video URLs (may be empty)
 *     scheduledAt:    string | null,   // ISO — WHEN set, the Make scenario
 *                                      // should hold the post until then
 *                                      // (Make "Sleep" module or scheduler)
 *     postPlatformId: string,          // post_platforms.id — echo it back or
 *                                      // match in Make's history for tracing
 *     tenantId:       string           // tracing only
 *   }
 *
 * Config lives in make_relay_config (one row per tenant, webhook URL
 * encrypted at rest with the same scheme as tenant API keys). No URL or
 * disabled relay → publishRelay() returns a clean skip so callers fall
 * back to the direct platform publisher without any special casing.
 */
import { createClient } from "@supabase/supabase-js";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";

/** Platforms the relay supports (all non-direct platforms + FB/IG). */
export const RELAY_PLATFORMS = new Set([
  "facebook",
  "instagram",
  "linkedin",
  "tiktok",
  "threads",
  "reddit",
  "pinterest",
]);

export interface RelayPayload {
  platform: string;
  caption: string;
  mediaUrls: string[];
  scheduledAt: string | null;
  postPlatformId: string;
  tenantId: string;
}

export interface RelayConfig {
  id: string;
  tenant_id: string;
  url_hint: string | null;
  enabled: boolean;
  last_test_at: string | null;
  last_test_ok: boolean | null;
  last_test_error: string | null;
}

function createServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

/** BYTEA → hex, whatever shape the driver hands over. */
function byteaToHex(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Buffer.isBuffer(value)) return value.toString("hex");
  if (typeof value === "string") {
    if (value.startsWith("{")) {
      try {
        const parsed = JSON.parse(value);
        if (parsed.type === "Buffer" && Array.isArray(parsed.data)) {
          return Buffer.from(parsed.data).toString("hex");
        }
      } catch {
        /* fall through */
      }
    }
    return value.replace(/^\\x/, "");
  }
  return "";
}

async function decryptUrl(encryptedHex: string): Promise<string | null> {
  try {
    const { decrypt } = await import("@/lib/encryption");
    const url = decrypt(encryptedHex);
    return url || null;
  } catch {
    return null;
  }
}

/** Get the tenant's relay config row (no decryption). */
export async function getRelayConfig(
  tenantId: string
): Promise<RelayConfig | null> {
  const supabase = createServiceSupabase();
  const { data } = await supabase
    .from("make_relay_config")
    .select(
      "id, tenant_id, url_hint, enabled, last_test_at, last_test_ok, last_test_error"
    )
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return (data as RelayConfig) ?? null;
}

/** Resolve the tenant's decrypted webhook URL, or null when unset/disabled. */
export async function getRelayWebhookUrl(
  tenantId: string
): Promise<string | null> {
  const supabase = createServiceSupabase();
  const { data } = await supabase
    .from("make_relay_config")
    .select("encrypted_url, enabled")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!data?.encrypted_url || data.enabled === false) return null;
  // Column is TEXT holding the hex string encrypt() emitted — pass straight
  // through. (BYTEA was tried first; supabase-js serializes Buffer params as
  // JSON text, which corrupted the ciphertext — see migration 112.)
  const stored = String(data.encrypted_url).replace(/^\\x/, "");
  return decryptUrl(stored);
}

/** HTTPS-only URL check — webhooks are credentials, never allow http://. */
export function isValidRelayUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return (
      (url.protocol === "https:" || url.hostname === "localhost") &&
      (url.hostname.endsWith(".make.com") ||
        url.hostname.endsWith(".make.com.") ||
        url.hostname === "localhost" ||
        // Make sometimes uses regional hook hosts (hook.eu2.make.com etc.)
        // — the endsWith above covers them. This branch allows self-hosted
        // relays explicitly listed via env for advanced setups.
        url.hostname === process.env.MAKE_RELAY_EXTRA_HOST ||
        false)
    );
  } catch {
    return false;
  }
}

/** Encrypt + upsert the tenant's webhook URL (the Settings save action). */
export async function saveRelayUrl(
  tenantId: string,
  rawUrl: string
): Promise<{ ok: boolean; error?: string; urlHint?: string }> {
  const url = rawUrl.trim();
  if (!isValidRelayUrl(url)) {
    return {
      ok: false,
      error:
        "That doesn't look like a Make.com webhook URL (expected https://hook…make.com/…).",
    };
  }
  const supabase = createServiceSupabase();
  const { encrypt } = await import("@/lib/encryption");
  // Same storage convention as tenant_api_keys: encrypt() → hex string →
  // Buffer for BYTEA. decrypt() on read expects exactly this shape.
  const encryptedHex = encrypt(url);
  const { error } = await supabase.from("make_relay_config").upsert(
    {
      tenant_id: tenantId,
      // TEXT column — store the hex string directly (see migration 112).
      encrypted_url: encryptedHex,
      url_hint: "…" + url.slice(-8),
      enabled: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id" }
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true, urlHint: "…" + url.slice(-8) };
}

/** Soft-disable without deleting the URL (keeps the config for re-enable). */
export async function setRelayEnabled(
  tenantId: string,
  enabled: boolean
): Promise<{ ok: boolean; error?: string }> {
  const supabase = createServiceSupabase();
  const { error } = await supabase
    .from("make_relay_config")
    .update({ enabled, updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Record a test-send outcome (Settings → Social "Send test post"). */
export async function recordRelayTest(
  tenantId: string,
  ok: boolean,
  error?: string
): Promise<void> {
  const supabase = createServiceSupabase();
  await supabase
    .from("make_relay_config")
    .update({
      last_test_at: new Date().toISOString(),
      last_test_ok: ok,
      last_test_error: error ?? null,
    })
    .eq("tenant_id", tenantId);
}

/**
 * Deliver one platform payload to the tenant's Make webhook.
 * Returns a PublishResult-compatible shape. A missing/disabled config is a
 * `skipped` outcome (not an error) so the publisher can fall back cleanly.
 */
export async function publishViaRelay(
  payload: RelayPayload
): Promise<{
  status: "published" | "failed" | "skipped";
  platformPostId?: string;
  platformPostUrl?: string;
  errorMessage?: string;
}> {
  const url = await getRelayWebhookUrl(payload.tenantId);
  if (!url) {
    return { status: "skipped", errorMessage: "Make relay not configured" };
  }
  if (!isValidRelayUrl(url)) {
    return { status: "failed", errorMessage: "Stored relay URL is invalid" };
  }

  try {
    const res = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      20_000
    );
    // Make webhooks 200/201 on accept; anything else is a delivery failure.
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        status: "failed",
        errorMessage: `Make webhook returned ${res.status}${text ? `: ${text.slice(0, 160)}` : ""}`,
      };
    }
    // Make's response body varies by scenario; surface the id if provided.
    let platformPostId: string | undefined;
    try {
      const body = await res.json();
      platformPostId =
        body?.id ?? body?.postId ?? body?.executionId ?? undefined;
    } catch {
      /* body not JSON — fine */
    }
    return { status: "published", platformPostId };
  } catch (err: any) {
    return {
      status: "failed",
      errorMessage: `Make relay request failed: ${err?.message ?? "unknown error"}`,
    };
  }
}
