import { createHmac, timingSafeEqual } from "crypto";

/**
 * HMAC-signed auth cookie values.
 *
 * The proxy derives the authoritative auth context (tenant, role, user id,
 * email, client id) from the *verified* Supabase session and writes it to the
 * x-* cookies. Server-side readers verify the signature before trusting the
 * value, so a client can never forge x-user-role=super_admin or point
 * x-tenant-id at another tenant — the two most damaging cookie attacks.
 *
 * The signature is deterministic (HMAC-SHA256), so a signed value is also a
 * stable bucket key for rate limiting.
 */

function signingSecret(): Buffer {
  const s = process.env.AUTH_COOKIE_SECRET || process.env.ENCRYPTION_KEY;
  if (!s) {
    // Local/dev fallback only. Production MUST set AUTH_COOKIE_SECRET (or
    // ENCRYPTION_KEY) or the signature is trivially forgeable.
    return Buffer.from("agency-os-dev-signing-secret", "utf8");
  }
  return Buffer.from(s, "utf8");
}

/** Append a deterministic HMAC-SHA256 signature: `<value>.<signature>`. */
export function signAuthValue(value: string): string {
  const sig = createHmac("sha256", signingSecret())
    .update(value)
    .digest("base64url");
  return `${value}.${sig}`;
}

/** Return the original value when the signature is valid, otherwise null. */
export function verifyAuthValue(signed: string): string | null {
  const idx = signed.lastIndexOf(".");
  if (idx <= 0 || idx === signed.length - 1) return null;
  const value = signed.slice(0, idx);
  const sig = signed.slice(idx + 1);
  const expected = createHmac("sha256", signingSecret())
    .update(value)
    .digest("base64url");
  const a = Buffer.from(sig, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return null;
  return timingSafeEqual(a, b) ? value : null;
}
