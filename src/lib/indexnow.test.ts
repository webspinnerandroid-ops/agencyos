import { describe, it, expect } from "vitest";
import { generateKey, platformHost } from "./indexnow";

describe("indexnow", () => {
  it("generates a 32-char hex key", async () => {
    const key = await generateKey();
    expect(key).toMatch(/^[a-f0-9]{32}$/);
  });

  it("generates unique keys", async () => {
    expect(await generateKey()).not.toBe(await generateKey());
  });

  it("extracts the canonical host from the site URL", async () => {
    const prev = process.env.NEXT_PUBLIC_SITE_URL;
    process.env.NEXT_PUBLIC_SITE_URL = "https://platform.blissmedialab.com";
    expect(await platformHost()).toBe("platform.blissmedialab.com");
    process.env.NEXT_PUBLIC_SITE_URL = prev;
  });
});
