/**
 * TOTP (RFC 6238) — authenticator-app codes, implemented on node's built-in
 * crypto (HMAC-SHA1, 6 digits, 30s period, ±1 step window). No external deps.
 */

import { createHmac, randomBytes } from "crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}

export function base32Decode(input: string): Buffer {
  const cleaned = input.toUpperCase().replace(/\s|=|1|0/g, "").replace(/8/g, "B").replace(/9/g, "G");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Generate a new random base32 secret (160 bits, like authenticator apps). */
export function generateSecret(): string {
  return base32Encode(randomBytes(20));
}

/** Compute the current TOTP code for a base32 secret at a given counter. */
export function totpAt(secret: string, counter: number, digits = 6): string {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(binCode % 10 ** digits).padStart(digits, "0");
}

/**
 * Verify a 6-digit code against the secret within a ±window step tolerance
 * (default 1 = the current + previous 30s window, matching authenticator apps).
 */
export function verifyTotp(secret: string, token: string, window = 1): boolean {
  const clean = String(token ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return false;
  const step = Math.floor(Date.now() / 30_000);
  for (let i = -window; i <= window; i++) {
    if (totpAt(secret, step + i) === clean) return true;
  }
  return false;
}

/** otpauth:// provisioning URI for QR codes (issuer + account label). */
export function provisioningUri(email: string, secret: string, issuer = "Agency OS"): string {
  const label = encodeURIComponent(`${issuer}:${email}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: "6",
    period: "30",
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
