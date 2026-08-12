import { describe, it, expect } from "vitest";
import {
  base32Encode,
  base32Decode,
  generateSecret,
  totpAt,
  verifyTotp,
  provisioningUri,
} from "./totp";

describe("totp", () => {
  it("RFC 6238 appendix B test vectors (SHA1, 8 digits)", () => {
    // Secret "12345678901234567890" (ASCII) — expected codes from the RFC.
    const secret = base32Encode(Buffer.from("12345678901234567890", "ascii"));
    const vector = (t: number) => {
      // totpAt returns 6 digits; pad to 8 for the RFC vector comparison.
      return totpAt(secret, Math.floor(t / 30), 8);
    };
    expect(vector(59)).toBe("94287082");
    expect(vector(1111111109)).toBe("07081804");
    expect(vector(1111111111)).toBe("14050471");
    expect(vector(1234567890)).toBe("89005924");
    expect(vector(2000000000)).toBe("69279037");
    expect(vector(20000000000)).toBe("65353130");
  });

  it("generates a 32-char base32 secret", () => {
    const secret = generateSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  });

  it("base32 round-trips", () => {
    const buf = Buffer.from("hello world", "ascii");
    expect(base32Decode(base32Encode(buf)).toString("ascii")).toBe("hello world");
  });

  it("accepts the current code and rejects garbage", () => {
    const secret = generateSecret();
    const step = Math.floor(Date.now() / 30_000);
    const current = totpAt(secret, step);
    expect(verifyTotp(secret, current)).toBe(true);
    expect(verifyTotp(secret, "000000")).toBe(false);
    expect(verifyTotp(secret, "abc")).toBe(false);
    expect(verifyTotp(secret, "")).toBe(false);
  });

  it("accepts a code from the previous step window", () => {
    const secret = generateSecret();
    const step = Math.floor(Date.now() / 30_000);
    expect(verifyTotp(secret, totpAt(secret, step - 1))).toBe(true);
  });

  it("builds a valid provisioning URI", () => {
    const uri = provisioningUri("test@example.com", "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567");
    expect(uri).toContain("otpauth://totp/Agency%20OS%3Atest%40example.com");
    expect(uri).toContain("secret=ABCDEFGHIJKLMNOPQRSTUVWXYZ234567");
    expect(uri).toContain("issuer=Agency+OS");
    expect(uri).toContain("digits=6");
  });
});
