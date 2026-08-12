import { describe, it, expect } from "vitest";
import { normalizeCaption } from "@/lib/ai/social-pipeline";

describe("normalizeCaption", () => {
  it("passes plain text through untouched", () => {
    const text = "Luxury is in the details you never see — but always feel.";
    expect(normalizeCaption(text)).toBe(text);
  });

  it("extracts the caption from a JSON envelope", () => {
    const raw = JSON.stringify({
      caption: "Hello world 👋",
      hashtags: ["#one", "#two"],
      firstComment: "",
    });
    expect(normalizeCaption(raw)).toBe("Hello world 👋");
  });

  it("appends a first-comment block when present", () => {
    const raw = JSON.stringify({
      caption: "Main caption",
      firstComment: "[FIRST COMMENT HASHTAGS]\n#a #b #c",
    });
    const out = normalizeCaption(raw);
    expect(out).toContain("Main caption");
    expect(out).toContain("[First comment] #a #b #c");
    expect(out).not.toContain("[FIRST COMMENT HASHTAGS]");
  });

  it("returns the raw text when JSON is malformed", () => {
    const raw = "{ not valid json";
    expect(normalizeCaption(raw)).toBe(raw);
  });

  it("handles an empty envelope gracefully", () => {
    expect(normalizeCaption("{}")).toBe("{}");
  });
});
