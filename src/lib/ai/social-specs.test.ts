import { describe, it, expect } from "vitest";
import {
  parseSpecOverrides,
  resolveSpec,
  enforceCharLimit,
  enforceCaptionSpec,
} from "./social-specs";

describe("parseSpecOverrides", () => {
  it("accepts valid overrides", () => {
    expect(
      parseSpecOverrides({ charLimit: 500, hashtagCount: 3, imageSize: "1080×1350" })
    ).toEqual({ charLimit: 500, hashtagCount: 3, imageSize: "1080×1350" });
  });

  it("rejects garbage types and absurd values", () => {
    expect(parseSpecOverrides({ charLimit: "lots" })).toEqual({});
    expect(parseSpecOverrides({ charLimit: -5 })).toEqual({});
    expect(parseSpecOverrides({ charLimit: 10 })).toEqual({}); // below the 40 floor
    expect(parseSpecOverrides({ hashtagCount: 1.5 })).toEqual({ hashtagCount: 1 });
    expect(parseSpecOverrides(null)).toEqual({});
    expect(parseSpecOverrides("nope")).toEqual({});
    expect(parseSpecOverrides([1, 2])).toEqual({});
  });

  it("trims long image-size strings", () => {
    const out = parseSpecOverrides({ imageSize: "x".repeat(100) });
    expect(out.imageSize?.length).toBe(60);
  });
});

describe("resolveSpec", () => {
  it("returns the platform default with no overrides", () => {
    const spec = resolveSpec("twitter", null);
    expect(spec.charLimit).toBe(280);
    expect(spec.source).toBe("platform");
  });

  it("falls back to Instagram's spec for unknown platforms", () => {
    expect(resolveSpec("myspace").charLimit).toBe(2200);
  });

  it("applies account overrides on top of the platform default", () => {
    const spec = resolveSpec("instagram", { charLimit: 1200, hashtagCount: 5 });
    expect(spec.charLimit).toBe(1200);
    expect(spec.hashtagCount).toBe(5);
    expect(spec.imageSize).toContain("1080"); // platform default survives
    expect(spec.source).toBe("account");
  });
});

describe("enforceCharLimit", () => {
  it("leaves fitting captions untouched", () => {
    expect(enforceCharLimit("Short and sweet.", 280)).toBe("Short and sweet.");
  });

  it("truncates at the last sentence boundary", () => {
    const caption =
      "First sentence stays here. Second sentence is also fine. Third sentence pushes way past the limit and talks about many things at length for no reason at all.";
    const out = enforceCharLimit(caption, 80);
    expect(out.length).toBeLessThanOrEqual(82); // limit + " …"
    expect(out.startsWith("First sentence stays here.")).toBe(true);
    expect(out.endsWith("…")).toBe(true);
  });

  it("falls back to a word boundary when no sentence fits", () => {
    const caption = "supercalifragilistic ".repeat(30);
    const out = enforceCharLimit(caption, 60);
    expect(out.length).toBeLessThanOrEqual(62);
    expect(out.endsWith("…")).toBe(true);
    // never mid-word
    expect(out.endsWith("supercalifragilistic")).toBe(false);
  });

  it("never returns an empty caption", () => {
    expect(enforceCharLimit("Hello wonderful world of captions everywhere", 20)).toBeTruthy();
  });
});

describe("enforceCaptionSpec", () => {
  it("passes through a compliant caption", () => {
    const out = enforceCaptionSpec("Perfectly fine caption.", ["#a"], "twitter", null);
    expect(out.caption).toBe("Perfectly fine caption.");
    expect(out.hashtags).toEqual(["#a"]);
    expect(out.truncated).toBe(false);
    expect(out.hashtagsTrimmed).toBe(false);
  });

  it("truncates an over-limit caption and records it", () => {
    const long = "Great. ".repeat(200); // 1400 chars
    const out = enforceCaptionSpec(long, [], "twitter", null);
    expect(out.truncated).toBe(true);
    expect(out.caption.length).toBeLessThanOrEqual(282);
  });

  it("trims hashtags to the account cap", () => {
    const out = enforceCaptionSpec(
      "caption",
      ["#a", "#b", "#c", "#d", "#e"],
      "instagram",
      { hashtagCount: 2 }
    );
    expect(out.hashtags).toEqual(["#a", "#b"]);
    expect(out.hashtagsTrimmed).toBe(true);
  });
});
