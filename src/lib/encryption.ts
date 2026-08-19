import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

/**
 * Encryption utility for storing API keys / OAuth tokens at rest.
 *
 * New writes use AES-256-GCM (authenticated encryption) with a random 12-byte
 * nonce and the 16-byte auth tag stored alongside the ciphertext, prefixed
 * with "v1:". GCM detects tampering, so a modified ciphertext fails decryption
 * instead of silently producing attacker-influenced plaintext (the weakness of
 * the previous AES-256-CBC implementation, which had no MAC).
 *
 * Legacy values written by the old CBC code have no "v1:" prefix and are still
 * decrypted transparently so existing stored tokens keep working.
 */

function getKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error(
      "ENCRYPTION_KEY environment variable is not set. " +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  // Legacy convention: ENCRYPTION_KEY is a 64-char hex string (32 bytes).
  if (/^[0-9a-fA-F]{64}$/.test(key)) return Buffer.from(key, "hex");
  // Accept any other secret by hashing it down to a stable 32-byte key.
  return createHash("sha256").update(key).digest();
}

/** Encrypt a plaintext string → "v1:<nonce+tag+ciphertext hex>". */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return "v1:" + Buffer.concat([nonce, tag, enc]).toString("hex");
}

/** Decrypt a value produced by `encrypt()` (or the legacy CBC format). */
export function decrypt(payload: string): string {
  const key = getKey();
  if (payload.startsWith("v1:")) {
    return decryptGcm(payload.slice(3), key);
  }
  return decryptLegacyCbc(payload, key);
}

function decryptGcm(hex: string, key: Buffer): string {
  try {
    const raw = Buffer.from(hex, "hex");
    if (raw.length < 28) return "";
    const nonce = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const data = raw.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    // Tampered ciphertext / bad auth tag — fail closed with an empty string,
    // matching the legacy behavior of never throwing.
    return "";
  }
}

/** Backward-compatible AES-256-CBC decrypt for pre-GCM stored values. */
function decryptLegacyCbc(payload: string, key: Buffer): string {
  try {
    const iv = Buffer.from(payload.substring(0, 32), "hex");
    const data = Buffer.from(payload.substring(32), "hex");
    const decipher = createDecipheriv("aes-256-cbc", key, iv);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
}
