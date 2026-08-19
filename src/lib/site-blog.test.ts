import { describe, expect, it } from "vitest";
import {
  slugifyTitle,
  deriveExcerpt,
  firstImageUrl,
  sanitizePostSlug,
} from "./site-blog";

describe("slugifyTitle", () => {
  it("lowercases and dashes", () => {
    expect(slugifyTitle("Hello, World!")).toBe("hello-world");
  });
  it("trims surrounding separators", () => {
    expect(slugifyTitle("  --SEO Tips & Tricks--  ")).toBe("seo-tips-tricks");
  });
});

describe("sanitizePostSlug", () => {
  it("accepts lowercase + dashes", () => {
    expect(sanitizePostSlug("my-first-post")).toBe("my-first-post");
  });
  it("rejects unsafe slugs", () => {
    expect(sanitizePostSlug("../../etc/passwd")).toBeNull();
    expect(sanitizePostSlug("has space")).toBeNull();
    expect(sanitizePostSlug("Upper")).toBe("upper"); // normalized
  });
});

describe("deriveExcerpt", () => {
  it("strips markdown and cuts at a word boundary", () => {
    const body =
      "# Title\n\n**Bold** and *italic* with [a link](https://x.com) and an image ![alt](https://x.com/i.png). " +
      "This is a much longer paragraph of plain words repeated over and over again so that the excerpt " +
      "logic actually has more than two hundred characters to work with and must cut at a word boundary " +
      "instead of returning the whole string untouched. " +
      "One more sentence to make absolutely sure we are comfortably past the limit before the test ends.";
    const excerpt = deriveExcerpt(body, "Fallback");
    expect(excerpt).not.toContain("**");
    expect(excerpt).not.toContain("![");
    expect(excerpt.endsWith("…")).toBe(true);
  });
  it("falls back to the title for empty bodies", () => {
    expect(deriveExcerpt("", "My Post Title")).toBe("My Post Title");
  });
});

describe("firstImageUrl", () => {
  it("extracts the first inline image", () => {
    expect(firstImageUrl("text ![hero](https://cdn/x.png) more")).toBe("https://cdn/x.png");
  });
  it("rejects data: URLs", () => {
    expect(firstImageUrl("![x](data:image/png;base64,AAAA)")).toBeNull();
  });
  it("returns null with no images", () => {
    expect(firstImageUrl("just prose")).toBeNull();
  });
});
