import { describe, it, expect } from "vitest";
import {
  buildRankMathMeta,
  buildArticleSchema,
  buildFaqSchema,
  schemaPreview,
} from "./rank-math-meta";

describe("buildRankMathMeta", () => {
  const base = {
    title: "Why Seasonal Coffee Menus Build Loyalty",
    metaDescription: "Seasonal coffee menus keep customers coming back. Here's why, plus a launch plan.",
    focusKeyword: "seasonal coffee menu",
    qaPairs: [
      { q: "What is a seasonal coffee menu?", a: "A rotating menu of limited-time drinks tied to the season." },
      { q: "How do seasonal menus build loyalty?", a: "Scarcity and anticipation create repeat visits." },
    ],
    slug: "seasonal-coffee-menus-loyalty",
    siteName: "Blue Frog Coffee",
  };

  it("produces the core Rank Math keys", () => {
    const { meta, summary } = buildRankMathMeta(base);
    expect(meta.rank_math_title).toBe(base.title);
    expect(meta.rank_math_description).toBe(base.metaDescription);
    expect(meta.rank_math_focus_keyword).toBe("seasonal coffee menu");
    expect(meta.rank_math_schema_Article).toContain("Article");
    expect(meta.rank_math_schema_FAQPage).toContain("FAQPage");
    expect(summary.schemaTypes).toEqual(["Article", "FAQPage"]);
    expect(summary.faqCount).toBe(2);
  });

  it("omits FAQPage schema when no Q&A pairs exist", () => {
    const { meta, summary } = buildRankMathMeta({ ...base, qaPairs: [] });
    expect(meta.rank_math_schema_FAQPage).toBeUndefined();
    expect(summary.schemaTypes).not.toContain("FAQPage");
  });

  it("adds OpenGraph + Twitter social meta from the featured image", () => {
    const { meta } = buildRankMathMeta({
      ...base,
      featuredImageUrl: "https://cdn.example.com/og.png",
    });
    expect(meta.rank_math_facebook_image).toBe("https://cdn.example.com/og.png");
    expect(meta.rank_math_twitter_image).toBe("https://cdn.example.com/og.png");
    expect(meta.rank_math_facebook_title).toBe(base.title);
    expect(meta.rank_math_twitter_description).toBe(base.metaDescription);
  });

  it("emits only the explicitly chosen schema types (Article always kept)", () => {
    const { meta, summary } = buildRankMathMeta({ ...base, schemaTypes: ["HowTo"] });
    expect(meta.rank_math_schema_Article).toBeDefined();
    expect(meta.rank_math_schema_FAQPage).toBeUndefined();
    expect(summary.schemaTypes).toContain("HowTo");
  });

  it("auto-detects HowTo from numbered steps in the body", () => {
    const body = "1. Grind the beans.\n2. Heat the water.\n3. Pour slowly.";
    const { meta, summary } = buildRankMathMeta({ ...base, body });
    expect(meta.rank_math_schema_HowTo).toBeDefined();
    expect(summary.schemaTypes).toContain("HowTo");
    expect(summary.stepCount).toBeGreaterThanOrEqual(2);
  });

  it("omits HowTo when the body has no steps", () => {
    const { meta } = buildRankMathMeta({ ...base, body: "No numbered steps here." });
    expect(meta.rank_math_schema_HowTo).toBeUndefined();
  });

  it("drops empty optional values", () => {
    const { meta } = buildRankMathMeta({
      title: "T",
      metaDescription: "",
      focusKeyword: "",
      qaPairs: [],
    });
    expect(meta.rank_math_title).toBe("T");
    expect(meta.rank_math_description).toBeUndefined();
    expect(meta.rank_math_focus_keyword).toBeUndefined();
    // Schema blocks still ship for the article.
    expect(meta.rank_math_schema_Article).toBeDefined();
    // No social blocks without a title-length description or image.
    expect(meta.rank_math_facebook_image).toBeUndefined();
  });
});

describe("buildArticleSchema", () => {
  it("includes headline, publisher and the featured image", () => {
    const schema = buildArticleSchema({
      title: "T",
      metaDescription: "D",
      focusKeyword: "k",
      featuredImageUrl: "https://cdn.example.com/img.png",
      siteName: "Acme",
    });
    expect(schema["@type"]).toEqual(["Article"]);
    expect((schema as any).publisher.name).toBe("Acme");
    expect((schema as any).image[0].url).toBe("https://cdn.example.com/img.png");
    expect((schema as any).datePublished).toBeDefined();
  });

  it("falls back to a default publisher name", () => {
    const schema = buildArticleSchema({ title: "T", metaDescription: "D", focusKeyword: "k" });
    expect((schema as any).publisher.name).toBe("Agency OS");
  });
});

describe("buildFaqSchema", () => {
  it("builds mainEntity from pairs and caps at 10", () => {
    const pairs = Array.from({ length: 14 }, (_, i) => ({ q: `Q${i}`, a: `A${i}` }));
    const schema = buildFaqSchema(pairs);
    expect(schema).not.toBeNull();
    expect(((schema as any).mainEntity ?? []).length).toBe(10);
  });

  it("filters empty answers", () => {
    const schema = buildFaqSchema([{ q: "Q", a: "" }, { q: "", a: "A" }, { q: "Q2", a: "A2" }]);
    expect(((schema as any)?.mainEntity ?? []).length).toBe(1);
  });
});

describe("schemaPreview", () => {
  it("returns both schema blocks as pretty JSON", () => {
    const preview = schemaPreview({
      title: "T",
      metaDescription: "D",
      focusKeyword: "k",
      qaPairs: [{ q: "Q", a: "A" }],
    });
    const parsed = JSON.parse(preview) as Record<string, unknown>[];
    expect(parsed.length).toBe(2);
    expect(parsed[0]["@type"]).toEqual(["Article"]);
    expect(parsed[1]["@type"]).toEqual(["FAQPage"]);
  });
});
