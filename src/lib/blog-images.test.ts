import { describe, it, expect } from "vitest";
import {
  MAX_BLOG_IMAGES,
  selectBlogImageSpecs,
  injectImagesIntoBody,
  insertAfterSectionParagraph,
  spaceOutImages,
  extractImagePlaceholders,
  stripLeftoverPlaceholders,
  type BlogImageSpec,
  type GeneratedBlogImage,
} from "./blog-images";

const spec = (over: Partial<BlogImageSpec> = {}): BlogImageSpec => ({
  prompt: "a prompt",
  placement: "inline",
  sectionTitle: "Section",
  description: "Alt",
  ...over,
});

const image = (over: Partial<GeneratedBlogImage> = {}): GeneratedBlogImage => ({
  spec: spec(),
  url: "https://img.example/x.png",
  ...over,
});

const countImages = (body: string) => (body.match(/!\[[^\]]*\]\([^)]*\)/g) || []).length;

const noAdjacent = (body: string) =>
  !/!\[[^\]]*\]\([^)]*\)\s*\n\s*\n\s*!\[[^\]]*\]\([^)]*\)/.test(body);

describe("selectBlogImageSpecs", () => {
  it("caps at MAX_BLOG_IMAGES total", () => {
    const specs = [
      spec({ placement: "featured", sectionTitle: "" }),
      ...Array.from({ length: 10 }, (_, i) =>
        spec({ sectionTitle: `Section ${i}` })
      ),
    ];
    const selected = selectBlogImageSpecs(specs);
    expect(selected.length).toBeLessThanOrEqual(MAX_BLOG_IMAGES);
  });

  it("keeps the featured image first", () => {
    const specs = [spec({ sectionTitle: "A" }), spec({ placement: "featured", sectionTitle: "" })];
    const selected = selectBlogImageSpecs(specs);
    expect(selected[0].placement).toBe("featured");
  });

  it("never selects two images for the same section", () => {
    const specs = [
      spec({ sectionTitle: "Shared" }),
      spec({ sectionTitle: "Shared" }),
      spec({ sectionTitle: "Other" }),
    ];
    const selected = selectBlogImageSpecs(specs);
    const titles = selected.map((s) => s.sectionTitle);
    expect(new Set(titles).size).toBe(titles.length);
  });
});

describe("injectImagesIntoBody", () => {
  it("replaces numbered placeholders with real URLs", () => {
    const body = [
      "Intro text.",
      "",
      "![feat](IMAGE_URL_1)",
      "",
      "## Section A",
      "",
      "Paragraph A.",
      "",
      "![inline](IMAGE_URL_2)",
    ].join("\n");
    const result = injectImagesIntoBody(body, [
      image({ spec: spec({ placement: "featured", sectionTitle: "" }), url: "https://img.example/feat.png" }),
      image({ spec: spec({ sectionTitle: "Section A" }), url: "https://img.example/a.png" }),
    ]);
    expect(result).toContain("https://img.example/feat.png");
    expect(result).toContain("https://img.example/a.png");
    expect(result).not.toContain("IMAGE_URL");
  });

  it("inserts inline image after the first paragraph of its section", () => {
    const body = [
      "## The Struggle",
      "",
      "First para of struggle.",
      "",
      "Second para.",
      "",
      "## The Shift",
      "",
      "Shift para.",
    ].join("\n");
    const result = injectImagesIntoBody(body, [
      image({ spec: spec({ sectionTitle: "The Struggle" }), url: "https://img.example/s.png" }),
    ]);
    const para1 = result.indexOf("First para of struggle.");
    const img = result.indexOf("https://img.example/s.png");
    const para2 = result.indexOf("Second para.");
    expect(para1).toBeGreaterThan(-1);
    expect(img).toBeGreaterThan(para1);
    expect(para2).toBeGreaterThan(img);
  });

  it("never leaves two images adjacent in the final body", () => {
    const body = [
      "Intro paragraph text.",
      "",
      "## Section A",
      "",
      "Paragraph A text here.",
      "",
      "![a](IMAGE_URL_1)",
      "",
      "![b](IMAGE_URL_2)",
      "",
      "## Section B",
      "",
      "Paragraph B text.",
      "",
      "![c](IMAGE_URL_3)",
    ].join("\n");
    const result = injectImagesIntoBody(body, [
      image({ spec: spec({ sectionTitle: "Section A" }), url: "https://img.example/a.png" }),
      image({ spec: spec({ sectionTitle: "Section B" }), url: "https://img.example/b.png" }),
      image({ spec: spec({ sectionTitle: "Nowhere" }), url: "https://img.example/c.png" }),
    ]);
    expect(noAdjacent(result)).toBe(true);
  });

  it("strips placeholders when fewer images are generated than the body expects", () => {
    // The exact failure shape: body survived a truncated JSON response with
    // IMAGE_URL_2/IMAGE_URL_3 tokens, but no structured specs did.
    const body = [
      "Intro paragraph.",
      "",
      "## Section One",
      "",
      "First paragraph of one.",
      "",
      "![friends](IMAGE_URL_2)",
      "",
      "## Section Two",
      "",
      "First paragraph of two.",
      "",
      "![laugh](IMAGE_URL_3)",
    ].join("\n");
    // Only the featured image was generated — both inline placeholders are unmatched.
    const result = injectImagesIntoBody(body, [
      image({ spec: spec({ placement: "featured", sectionTitle: "" }), url: "https://img.example/feat.png" }),
    ]);
    expect(result).not.toContain("IMAGE_URL");
    expect(result).toContain("https://img.example/feat.png");
    expect(result).toContain("Section One");
    expect(result).toContain("Section Two");
  });

  it("strips all placeholders when no images were generated at all", () => {
    const body = [
      "Intro.",
      "",
      "![a](IMAGE_URL_2)",
      "",
      "## Section",
      "",
      "Text.",
    ].join("\n");
    const result = injectImagesIntoBody(body, []);
    expect(result).not.toContain("IMAGE_URL");
    expect(result).not.toContain("![a]");
    expect(result).toContain("## Section");
  });
});

describe("extractImagePlaceholders", () => {
  it("finds placeholders in document order with index and alt text", () => {
    const body = [
      "Intro.",
      "",
      "![inline one](IMAGE_URL_2)",
      "",
      "![inline two](IMAGE_URL_3)",
    ].join("\n");
    expect(extractImagePlaceholders(body)).toEqual([
      { index: 2, alt: "inline one" },
      { index: 3, alt: "inline two" },
    ]);
  });

  it("handles IMAGE_URL1 without underscore and empty alt", () => {
    expect(extractImagePlaceholders("![feat](IMAGE_URL1)")).toEqual([
      { index: 1, alt: "feat" },
    ]);
    expect(extractImagePlaceholders("![](IMAGE_URL_4)")).toEqual([
      { index: 4, alt: "" },
    ]);
  });

  it("ignores real image URLs", () => {
    expect(extractImagePlaceholders("![a](https://img.example/x.png)")).toEqual([]);
  });
});

describe("stripLeftoverPlaceholders", () => {
  it("removes unmatched placeholder tokens and collapses blank lines", () => {
    const body = [
      "Para.",
      "",
      "![lost](IMAGE_URL_3)",
      "",
      "",
      "## Next",
    ].join("\n");
    const result = stripLeftoverPlaceholders(body);
    expect(result).not.toContain("IMAGE_URL");
    expect(result).not.toContain("lost");
    expect(result).toContain("## Next");
    expect(result).not.toMatch(/\n{3,}/);
  });
});

describe("insertAfterSectionParagraph", () => {
  it("returns null when the heading is missing", () => {
    expect(
      insertAfterSectionParagraph("## Other\n\nText.", "Missing", "![x](u)")
    ).toBeNull();
  });

  it("returns null when the heading has no paragraph after it", () => {
    expect(
      insertAfterSectionParagraph("## Only\n", "Only", "![x](u)")
    ).toBeNull();
  });
});

describe("spaceOutImages", () => {
  it("moves a stacked image after the next text block", () => {
    const body = [
      "Intro.",
      "",
      "![a](U1)",
      "",
      "![b](U2)",
      "",
      "Middle paragraph.",
      "",
      "![c](U3)",
      "",
      "End.",
    ].join("\n");
    const result = spaceOutImages(body);
    expect(noAdjacent(result)).toBe(true);
    expect(countImages(result)).toBe(3);
  });

  it("keeps already-spaced content unchanged", () => {
    const body = [
      "![feat](U1)",
      "",
      "Intro text.",
      "",
      "![a](U2)",
      "",
      "More text.",
      "",
      "![b](U3)",
      "",
      "End text.",
    ].join("\n");
    expect(spaceOutImages(body)).toBe(body);
  });

  it("preserves image order", () => {
    const body = [
      "![a](U1)",
      "",
      "![b](U2)",
      "",
      "![c](U3)",
      "",
      "Text.",
    ].join("\n");
    const result = spaceOutImages(body);
    const order = [...result.matchAll(/!\[[^\]]*\]\(([^)]*)\)/g)].map((m) => m[1]);
    expect(order).toEqual(["U1", "U2", "U3"]);
  });

  it("splits a block containing consecutive image lines without blank lines", () => {
    const body = ["Intro.", "", "![a](U1)", "![b](U2)", "", "More text."].join("\n");
    const result = spaceOutImages(body);
    expect(noAdjacent(result)).toBe(true);
    expect(countImages(result)).toBe(2);
  });
});
