import { describe, it, expect } from "vitest";
import {
  buildWpSeoMeta,
  buildArticleSchema,
  buildFaqSchema,
  schemaPreview,
} from "./wp-seo-meta";

describe("buildWpSeoMeta", () => {
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

  it("produces the core WordPress SEO keys", () => {
    const { meta, summary } = buildWpSeoMeta(base);
    expect(meta.seo_title).toBe(base.title);
    expect(meta.seo_description).toBe(base.metaDescription);
    expect(meta.focus_keyword).toBe("seasonal coffee menu");
    expect(meta.schema_Article).toContain("Article");
    expect(meta.schema_FAQPage).toContain("FAQPage");
    // Combined JSON-LD array for guaranteed in-content delivery.
    expect(Array.isArray(JSON.parse(meta.schema_jsonld as string))).toBe(true);
    expect(summary.schemaTypes).toEqual(["Article", "FAQPage"]);
    expect(summary.faqCount).toBe(2);
  });

  it("omits FAQPage schema when no Q&A pairs exist", () => {
    const { meta, summary } = buildWpSeoMeta({ ...base, qaPairs: [] });
    expect(meta.schema_FAQPage).toBeUndefined();
    expect(summary.schemaTypes).not.toContain("FAQPage");
  });

  it("adds OpenGraph + Twitter social meta from the featured image", () => {
    const { meta } = buildWpSeoMeta({
      ...base,
      featuredImageUrl: "https://cdn.example.com/og.png",
    });
    expect(meta.og_image).toBe("https://cdn.example.com/og.png");
    expect(meta.twitter_image).toBe("https://cdn.example.com/og.png");
    expect(meta.og_title).toBe(base.title);
    expect(meta.twitter_description).toBe(base.metaDescription);
  });

  it("emits only the explicitly chosen schema types (Article always kept)", () => {
    const { meta, summary } = buildWpSeoMeta({ ...base, schemaTypes: ["HowTo"] });
    expect(meta.schema_Article).toBeDefined();
    expect(meta.schema_FAQPage).toBeUndefined();
    expect(summary.schemaTypes).toContain("HowTo");
  });

  it("builds the extra schema types when requested", () => {
    const { meta, summary } = buildWpSeoMeta({
      ...base,
      schemaTypes: ["Product", "Service", "Organization", "Event", "Course", "SoftwareApplication", "VideoObject", "Person"],
    });
    expect(meta.schema_Product).toContain("Product");
    expect(meta.schema_Service).toContain("Service");
    expect(meta.schema_Organization).toContain("Organization");
    expect(meta.schema_Event).toContain("Event");
    expect(meta.schema_Course).toContain("Course");
    expect(meta.schema_SoftwareApplication).toContain("SoftwareApplication");
    expect(meta.schema_VideoObject).toContain("VideoObject");
    expect(meta.schema_Person).toContain("Person");
    expect(summary.schemaTypes).toContain("Product");
  });

  it("auto-detects HowTo from numbered steps in the body", () => {
    const body = "1. Grind the beans.\n2. Heat the water.\n3. Pour slowly.";
    const { meta, summary } = buildWpSeoMeta({ ...base, body });
    expect(meta.schema_HowTo).toBeDefined();
    expect(summary.schemaTypes).toContain("HowTo");
    expect(summary.stepCount).toBeGreaterThanOrEqual(2);
  });

  it("omits HowTo when the body has no steps", () => {
    const { meta } = buildWpSeoMeta({ ...base, body: "No numbered steps here." });
    expect(meta.schema_HowTo).toBeUndefined();
  });

  it("drops empty optional values", () => {
    const { meta } = buildWpSeoMeta({
      title: "T",
      metaDescription: "",
      focusKeyword: "",
      qaPairs: [],
    });
    expect(meta.seo_title).toBe("T");
    expect(meta.seo_description).toBeUndefined();
    expect(meta.focus_keyword).toBeUndefined();
    // Schema blocks still ship for the article.
    expect(meta.schema_Article).toBeDefined();
    // No social blocks without a title-length description or image.
    expect(meta.og_image).toBeUndefined();
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
