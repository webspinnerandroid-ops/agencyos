// ============================================================================
// Web Push (PWA notifications) — dependency-free VAPID.
//
// The browser subscribes via PushManager using our VAPID public key, the
// subscription is stored in push_subscriptions, and createNotification fires
// a push for every matching subscription when a bell notification lands.
//
// Design: pushes carry an EMPTY body. The service worker, on receiving a
// push, fetches /api/push/pending (its own fetch includes the session cookie,
// so the middleware authenticates it like any page request) and shows the
// real notification with a link + unread count. This skips Web Push payload
// encryption (RFC 8291) entirely — far less code to keep secure.
//
// Fire-and-forget everywhere: a push failure must never break the
// notification that produced it.
// ============================================================================

import { createServiceClient } from "@/lib/supabase/server";

const VAPID_SUBJECT = "mailto:alerts@platform.blissmedialab.com";
const VAPID_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
const VAPID_EXPIRY_SECONDS = 12 * 60 * 60; // 12 hours

function b64url(buf: Uint8Array): string {
  return Buffer.from(buf).toString("base64url");
}

/** Load the VAPID keypair, generating + persisting it on first use. */
async function getOrCreateVapidKeys(): Promise<{
  privateJwk: JsonWebKey;
  publicKey: string;
} | null> {
  try {
    const supabase = await createServiceClient();
    const { data: row } = await supabase
      .from("vapid_keys")
      .select("private_jwk, public_key")
      .eq("id", 1)
      .maybeSingle();
    if (row) {
      return {
        privateJwk: JSON.parse(row.private_jwk) as JsonWebKey,
        publicKey: row.public_key,
      };
    }

    // First use — generate a P-256 keypair and persist it.
    const keyPair = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"]
    );
    const privateJwk = (await crypto.subtle.exportKey(
      "jwk",
      keyPair.privateKey
    )) as JsonWebKey;
    const rawPublic = new Uint8Array(
      await crypto.subtle.exportKey("raw", keyPair.publicKey)
    );
    const publicKey = b64url(rawPublic);

    const { error } = await supabase
      .from("vapid_keys")
      .insert({ id: 1, private_jwk: JSON.stringify(privateJwk), public_key: publicKey });
    if (error) {
      // Another instance may have won the race — read back.
      const { data: readback } = await supabase
        .from("vapid_keys")
        .select("private_jwk, public_key")
        .eq("id", 1)
        .maybeSingle();
      if (readback) {
        return {
          privateJwk: JSON.parse(readback.private_jwk) as JsonWebKey,
          publicKey: readback.public_key,
        };
      }
      console.warn("[web-push] Could not persist VAPID keys:", error.message);
    }
    return { privateJwk, publicKey };
  } catch (err) {
    console.warn("[web-push] getOrCreateVapidKeys failed:", err);
    return null;
  }
}

/** The base64url VAPID public key the browser subscribes with. */
export async function getVapidPublicKey(): Promise<string | null> {
  const keys = await getOrCreateVapidKeys();
  return keys?.publicKey ?? null;
}

/** ES256 JWT signed with the stored VAPID private key. */
async function signVapidJwt(
  privateJwk: JsonWebKey,
  audience: string
): Promise<string | null> {
  try {
    const privateKey = await crypto.subtle.importKey(
      "jwk",
      privateJwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"]
    );
    const header = { alg: "ES256", typ: "JWT" };
    const payload = {
      aud: audience,
      exp: Math.floor(Date.now() / 1000) + VAPID_EXPIRY_SECONDS,
      sub: VAPID_SUBJECT,
    };
    const encoder = new TextEncoder();
    const input =
      b64url(encoder.encode(JSON.stringify(header))) +
      "." +
      b64url(encoder.encode(JSON.stringify(payload)));
    const signature = new Uint8Array(
      await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        privateKey,
        encoder.encode(input)
      )
    );
    return `${input}.${b64url(signature)}`;
  } catch (err) {
    console.warn("[web-push] signVapidJwt failed:", err);
    return null;
  }
}

export interface WebPushInput {
  tenantId: string;
  /** Null = every user in the tenant. */
  userId?: string | null;
  kind: string;
  title: string;
  body?: string | null;
  link?: string | null;
}

/**
 * Fire an empty-payload push to every stored subscription for the tenant
 * (or user). The service worker fetches the actual notification payload from
 * /api/push/pending. Never throws.
 */
export async function webPushNotify(input: WebPushInput): Promise<void> {
  try {
    const keys = await getOrCreateVapidKeys();
    if (!keys) return;
    const supabase = await createServiceClient();
    let query = supabase
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth")
      .eq("tenant_id", input.tenantId);
    if (input.userId) query = query.eq("user_id", input.userId);
    const { data, error } = await query;
    if (error || !data || data.length === 0) return;

    const urgency =
      input.kind === "approval" || input.kind === "alert" ? "high" : "normal";
    for (const sub of data as { endpoint: string }[]) {
      const endpoint = sub.endpoint;
      if (!/^https:\/\//.test(endpoint)) continue;
      try {
        const audience = new URL(endpoint).origin;
        const jwt = await signVapidJwt(keys.privateJwk, audience);
        if (!jwt) continue;
        await fetch(endpoint, {
          method: "POST",
          headers: {
            Authorization: `vapid t=${jwt}, k=${keys.publicKey}`,
            "Content-Type": "application/octet-stream",
            TTL: String(VAPID_TTL_SECONDS),
            Urgency: urgency,
            "Content-Length": "0",
          },
          body: "",
        });
      } catch (err) {
        console.warn("[web-push] send to endpoint failed:", err);
      }
    }
    // Opportunistic: notify the table we honored each endpoint (best-effort).
    try {
      await supabase
        .from("push_subscriptions")
        .update({ last_seen_at: new Date().toISOString() })
        .eq("tenant_id", input.tenantId)
        .in("endpoint", data.map((d) => d.endpoint));
    } catch {
      // best-effort
    }
  } catch (err) {
    console.warn("[web-push] webPushNotify failed:", err);
  }
}