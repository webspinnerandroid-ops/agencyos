import { describe, it, expect } from "vitest";
import { deriveKeyword } from "./analyzer";

describe("deriveKeyword", () => {
  it("uses the title's significant words", () => {
    const kw = deriveKeyword(
      "How Seasonal Coffee Menus Build Loyalty",
      "body text about coffee"
    );
    expect(kw.toLowerCase()).toContain("coffee");
  });

  it("never returns the old placeholder domain keyword for plain text", () => {
    const kw = deriveKeyword("", "Coffee loyalty programs drive repeat visits. Coffee shops that rotate menus keep customers returning. Coffee drinkers love limited-time offers.");
    expect(kw).not.toBe("example");
    expect(kw.length).toBeGreaterThan(2);
  });

  it("falls back to the most frequent content word when title is empty", () => {
    const text =
      "coffee coffee coffee roasting beans beans espresso espresso espresso espresso";
    const kw = deriveKeyword("", text);
    expect(kw.toLowerCase()).toBe("espresso");
  });

  it("returns empty when nothing usable exists", () => {
    const kw = deriveKeyword("", "a");
    expect(kw).toBe("");
  });

  it("ignores placeholder titles so rewrites stay on-topic", () => {
    // "Rewritten content" used to become the keyword — the root cause of
    // off-topic rewrites. It must never leak into the detected keyword.
    const kw = deriveKeyword(
      "Rewritten content",
      "Software development services help businesses build custom applications that scale with demand."
    );
    expect(kw.toLowerCase()).not.toContain("rewritten");
    expect(kw.toLowerCase()).not.toContain("content");
    expect(kw.toLowerCase()).toContain("software");
  });

  it("ignores the pasted-content placeholder too", () => {
    const kw = deriveKeyword("Pasted content", "Marketing automation platforms save teams hours every week.");
    expect(kw.toLowerCase()).not.toContain("pasted");
    expect(kw.toLowerCase()).not.toContain("content");
  });
});
