import { describe, it, expect } from "vitest";
import { isValidRelayUrl, RELAY_PLATFORMS } from "./makeRelay";

/**
 * The Make relay's security-critical surface is URL validation: the webhook
 * URL is a bearer credential (anyone holding it can post to the tenant's
 * social accounts), so the validator must accept real Make hook hosts and
 * reject lookalikes, non-HTTPS, and garbage. These tests pin that behavior.
 */
describe("Make relay URL validation", () => {
  it("accepts real Make.com webhook hosts (all regions)", () => {
    expect(isValidRelayUrl("https://hook.eu2.make.com/abc123")).toBe(true);
    expect(isValidRelayUrl("https://hook.us1.make.com/token")).toBe(true);
    expect(isValidRelayUrl("https://hook.make.com/xyz")).toBe(true);
  });

  it("rejects non-HTTPS and non-Make hosts", () => {
    expect(isValidRelayUrl("http://hook.eu2.make.com/abc123")).toBe(false);
    expect(isValidRelayUrl("https://evil.example.com/hook")).toBe(false);
    expect(isValidRelayUrl("https://hook.eu2.make.com.evil.io/steal")).toBe(
      false
    );
    expect(isValidRelayUrl("https://make.com.hook.evil.io/x")).toBe(false);
  });

  it("rejects garbage and empty input", () => {
    expect(isValidRelayUrl("")).toBe(false);
    expect(isValidRelayUrl("not a url")).toBe(false);
    expect(isValidRelayUrl("javascript:alert(1)")).toBe(false);
  });
});

describe("Make relay platform coverage", () => {
  it("covers every non-direct platform plus Facebook and Instagram", () => {
    for (const p of [
      "facebook",
      "instagram",
      "linkedin",
      "tiktok",
      "threads",
      "reddit",
      "pinterest",
    ]) {
      expect(RELAY_PLATFORMS.has(p), p).toBe(true);
    }
  });

  it("excludes the direct-OAuth platforms that bypass the relay", () => {
    expect(RELAY_PLATFORMS.has("twitter")).toBe(false);
    expect(RELAY_PLATFORMS.has("youtube")).toBe(false);
    expect(RELAY_PLATFORMS.has("gbp")).toBe(false);
  });
});
