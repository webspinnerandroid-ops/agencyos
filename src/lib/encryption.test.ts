import { describe, it, expect, beforeAll } from "vitest";
import { createCipheriv, randomBytes } from "crypto";
import { encrypt, decrypt } from "./encryption";

const KEY_HEX = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("encryption", () => {
  beforeAll(() => {
    process.env.ENCRYPTION_KEY = KEY_HEX;
  });

  it("round-trips through AES-256-GCM", () => {
    const enc = encrypt("hello world");
    expect(enc.startsWith("v1:")).toBe(true);
    expect(decrypt(enc)).toBe("hello world");
  });

  it("uses a fresh nonce per encryption", () => {
    const a = encrypt("same plaintext");
    const b = encrypt("same plaintext");
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe("same plaintext");
    expect(decrypt(b)).toBe("same plaintext");
  });

  it("fails closed on tampered ciphertext (auth tag)", () => {
    const enc = encrypt("secret value");
    const raw = Buffer.from(enc.slice(3), "hex");
    raw[raw.length - 1] ^= 0xff; // flip one ciphertext bit
    expect(decrypt("v1:" + raw.toString("hex"))).toBe("");
  });

  it("still decrypts legacy AES-256-CBC values", () => {
    const key = Buffer.from(KEY_HEX, "hex");
    const iv = randomBytes(16);
    const cipher = createCipheriv("aes-256-cbc", key, iv);
    const enc = Buffer.concat([cipher.update("legacy token", "utf8"), cipher.final()]);
    const legacy = iv.toString("hex") + enc.toString("hex");
    expect(decrypt(legacy)).toBe("legacy token");
  });
});
