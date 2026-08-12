import { describe, it, expect } from "vitest";
import { platformPostUrl, mediaIdToShortcode } from "./social-links";

describe("mediaIdToShortcode", () => {
  it("converts a numeric Instagram media id to a shortcode", () => {
    // 1 -> "B" (base64 alphabet: A=0..Z=25,a=26..z=51,0=52..9=61,-=62,_=63)
    expect(mediaIdToShortcode("1")).toBe("B");
    expect(mediaIdToShortcode("0")).toBe(null); // 0 has no representation
  });

  it("rejects non-numeric ids", () => {
    expect(mediaIdToShortcode("abc")).toBe(null);
    expect(mediaIdToShortcode("")).toBe(null);
  });
});

describe("platformPostUrl", () => {
  it("prefers a stored URL over derivation", () => {
    const url = platformPostUrl("instagram", "123", "https://www.instagram.com/p/STORED/");
    expect(url).toBe("https://www.instagram.com/p/STORED/");
  });

  it("builds an X/Twitter status URL from the post id", () => {
    expect(platformPostUrl("twitter", "123456789", null)).toBe(
      "https://x.com/i/web/status/123456789"
    );
    expect(platformPostUrl("x", "42", undefined)).toBe("https://x.com/i/web/status/42");
  });

  it("builds a LinkedIn feed URL from an id or a full URN", () => {
    expect(platformPostUrl("linkedin", "987654", null)).toBe(
      "https://www.linkedin.com/feed/update/urn:li:share:987654"
    );
    expect(platformPostUrl("linkedin", "urn:li:share:123456789", null)).toBe(
      "https://www.linkedin.com/feed/update/urn:li:share:123456789"
    );
  });

  it("derives an Instagram post URL from a numeric media id", () => {
    // 1 -> shortcode "B" -> /p/B/
    expect(platformPostUrl("instagram", "1", null)).toBe(
      "https://www.instagram.com/p/B/"
    );
  });

  it("builds a Facebook story URL from a numeric fbid", () => {
    expect(platformPostUrl("facebook", "1000111222333", null)).toBe(
      "https://www.facebook.com/story.php?story_fbid=1000111222333"
    );
  });

  it("returns null when nothing can be resolved (no id, unknown platform)", () => {
    expect(platformPostUrl("tiktok", "123", null)).toBe(null);
    expect(platformPostUrl("instagram", "", null)).toBe(null);
    expect(platformPostUrl("twitter", null, null)).toBe(null);
  });
});
