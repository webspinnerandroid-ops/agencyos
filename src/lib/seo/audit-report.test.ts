import { describe, it, expect } from "vitest";
import { brandKeyword, homepageMarkdown } from "./audit-report";
import { scoreContent } from "@/lib/rankmath";
import { scoreAeoGeo } from "@/lib/aeo-geo";

describe("brandKeyword", () => {
  it("derives the brand from the domain", () => {
    expect(brandKeyword("https://giantbyte.com/")).toBe("giantbyte");
    expect(brandKeyword("https://www.bucklandmuseum.org")).toBe("bucklandmuseum");
    expect(brandKeyword("https://aws.1110ths.org/page")).toBe("1110ths");
  });

  it("falls back to the raw string on garbage input", () => {
    expect(brandKeyword("not a url")).toBe("not a url");
  });
});

describe("homepageMarkdown", () => {
  const samplePage = {
    url: "https://bucklandmuseum.org/",
    title: "Buckland Museum of Witchcraft & Magick",
    metaDescription: "Buckland Museum of Witchcraft & Magick in Cleveland, Ohio.",
    h1: ["Buckland Museum of Witchcraft & Magick"],
    h2: ["Visit us", "Our collection"],
    h3: ["Hours", "Directions"],
    textPreview:
      "Welcome to the Buckland Museum of Witchcraft & Magick. The museum is in Cleveland, Ohio and is open to visitors. Learn about the history of witchcraft and magick through our collection.",
    images: [
      { src: "https://bucklandmuseum.org/img/museum.jpg", alt: "Museum facade", hasAlt: true },
    ],
    internalLinks: [{ href: "https://bucklandmuseum.org/visit", text: "Visit" }],
    externalLinks: [
      { href: "https://en.wikipedia.org/wiki/Witchcraft", text: "Wikipedia" },
    ],
  };

  it("rebuilds markdown with headings, links, and images", () => {
    const md = homepageMarkdown(samplePage);
    expect(md).toContain("# Buckland Museum of Witchcraft & Magick");
    expect(md).toContain("## Visit us");
    expect(md).toContain("### Hours");
    expect(md).toContain("[Visit](https://bucklandmuseum.org/visit)");
    expect(md).toContain("[Wikipedia](https://en.wikipedia.org/wiki/Witchcraft)");
    expect(md).toContain("![Museum facade](https://bucklandmuseum.org/img/museum.jpg)");
  });

  it("handles empty input", () => {
    expect(homepageMarkdown(undefined)).toBe("");
    expect(homepageMarkdown({})).toBe("");
  });

  it("produces content the scoring engines can run on", () => {
    const md = homepageMarkdown(samplePage);
    const seo = scoreContent({
      title: samplePage.title,
      metaDescription: samplePage.metaDescription,
      slug: "/",
      body: md,
      keyword: "bucklandmuseum",
      internalUrls: ["https://bucklandmuseum.org/visit"],
    });
    const aeo = scoreAeoGeo({
      title: samplePage.title,
      metaDescription: samplePage.metaDescription,
      body: md,
      keyword: "bucklandmuseum",
    });
    // The reconstruction must at least be parseable: subheadings and links
    // detected, no crashes, real totals in range.
    expect(seo.wordCount).toBeGreaterThan(20);
    expect(seo.total).toBeGreaterThanOrEqual(0);
    expect(seo.total).toBeLessThanOrEqual(100);
    expect(aeo.total).toBeGreaterThanOrEqual(0);
    expect(aeo.total).toBeLessThanOrEqual(100);
    expect(seo.checks.some((c) => c.id === "internal" && c.passed)).toBe(true);
    expect(seo.checks.some((c) => c.id === "outbound" && c.passed)).toBe(true);
    expect(seo.checks.some((c) => c.id === "subheadings" && c.passed)).toBe(true);
  });
});
