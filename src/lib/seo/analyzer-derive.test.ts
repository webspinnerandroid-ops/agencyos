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

  it("returns a last-resort phrase when nothing usable exists", () => {
    const kw = deriveKeyword("", "a");
    expect(kw).toBe("the topic");
  });
});
