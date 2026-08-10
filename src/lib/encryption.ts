import CryptoJS from "crypto-js";

/**
 * Encryption utility for securing API keys before storing them in the
 * `tenant_api_keys` table.
 *
 * Uses AES-256-CBC with a key derived from the ENCRYPTION_KEY environment
 * variable. The encrypted payload includes a random IV prepended to the
 * ciphertext so every encryption of the same plaintext yields a different
 * result.
 */

function getEncryptionKey(): string {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error(
      "ENCRYPTION_KEY environment variable is not set. " +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }
  return key;
}

/**
 * Encrypt a plaintext string. Returns a hex-encoded string containing
 * the IV (first 32 hex chars) followed by the ciphertext.
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = CryptoJS.lib.WordArray.random(16);
  const encrypted = CryptoJS.AES.encrypt(plaintext, CryptoJS.enc.Hex.parse(key), {
    iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });
  // Prepend IV as hex so we can extract it during decryption
  const ivHex = iv.toString(CryptoJS.enc.Hex);
  const cipherHex = encrypted.ciphertext.toString(CryptoJS.enc.Hex);
  return ivHex + cipherHex;
}

/**
 * Decrypt a hex-encoded string produced by `encrypt()`.
 */
export function decrypt(encryptedHex: string): string {
  const key = getEncryptionKey();
  // First 32 hex chars = 16 bytes IV
  const ivHex = encryptedHex.substring(0, 32);
  const cipherHex = encryptedHex.substring(32);

  const iv = CryptoJS.enc.Hex.parse(ivHex);
  const ciphertext = CryptoJS.enc.Hex.parse(cipherHex);

  const decrypted = CryptoJS.AES.decrypt(
    { ciphertext } as CryptoJS.lib.CipherParams,
    CryptoJS.enc.Hex.parse(key),
    {
      iv,
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7,
    }
  );

  return decrypted.toString(CryptoJS.enc.Utf8);
}