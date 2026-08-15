import { describe, it, expect } from "vitest";
import { brandKeyword, homepageMarkdown, scoreCompetitorHtml } from "./audit-report";
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

  it("scores competitor homepage HTML with the same engines", () => {
    const html = `
      <!DOCTYPE html><html><head>
        <title>GiantByte Software — Custom Web Apps</title>
        <meta name="description" content="GiantByte Software builds custom web applications and digital products for growing companies." />
      </head><body>
        <h1>GiantByte Software</h1>
        <p>GiantByte Software is a development studio that builds custom web applications.</p>
        <p>How do we work? We pair a senior developer with your team from day one, and ship in two-week sprints.</p>
        <h2>Services</h2>
        <p>Custom web apps, APIs, and automation for growing companies since 2016.</p>
        <h3>Why clients choose us</h3>
        <p>According to our 2025 client survey, 9 in 10 clients renew.</p>
        <a href="https://giantbyte.com/portfolio">Portfolio</a>
        <a href="https://github.com">GitHub</a>
        <img src="https://giantbyte.com/img/team.jpg" alt="GiantByte Software team" />
      </body></html>
    `;
    const scores = scoreCompetitorHtml(html, "https://giantbyte.com/");
    expect(scores.crawled).toBe(true);
    expect(scores.title).toContain("GiantByte");
    expect(scores.seoScore).toBeGreaterThanOrEqual(0);
    expect(scores.seoScore).toBeLessThanOrEqual(100);
    expect(scores.aeoScore).toBeGreaterThanOrEqual(0);
    expect(scores.geoScore).toBeGreaterThanOrEqual(0);
    expect(scores.wordCount).toBeGreaterThan(20);
  });

  it("includes per-check breakdowns for crawled competitors", () => {
    const html = `
      <html><head>
        <title>GiantByte Software — Custom Web Apps</title>
        <meta name="description" content="GiantByte Software builds custom web applications, APIs, and automation for growing companies." />
      </head><body>
        <h1>GiantByte Software</h1>
        <p>GiantByte Software is a development studio that builds custom web applications.</p>
        <h2>Services</h2>
        <p>Custom web apps, APIs, and automation for growing companies since 2016.</p>
        <img src="https://giantbyte.com/img/team.jpg" alt="GiantByte team" />
      </body></html>
    `;
    const scores = scoreCompetitorHtml(html, "https://giantbyte.com/");
    expect(scores.crawled).toBe(true);
    expect(Array.isArray(scores.seoChecks)).toBe(true);
    expect(scores.seoChecks!.length).toBeGreaterThan(0);
    // Every SEO check carries the fields the UI renders.
    for (const c of scores.seoChecks!) {
      expect(c.label).toBeTruthy();
      expect(typeof c.maxPoints).toBe("number");
      expect(typeof c.earned).toBe("number");
      expect(typeof c.passed).toBe("boolean");
    }
    expect(Array.isArray(scores.aeoGeoChecks)).toBe(true);
    expect(scores.aeoGeoChecks!.length).toBeGreaterThan(0);
    // AEO/GEO checks must be tagged with their pillar so the UI can split them.
    const pillars = new Set(scores.aeoGeoChecks!.map((c) => c.pillar));
    expect(pillars.has("AEO") || pillars.has("GEO")).toBe(true);
    const seoTotal = scores.seoChecks!.reduce((s, c) => s + c.earned, 0);
    expect(Math.min(seoTotal, 100)).toBe(scores.seoScore);
  });

  it("reports not-crawled for unusable HTML", () => {
    const scores = scoreCompetitorHtml("<html><body></body></html>", "https://empty.example.com/");
    expect(scores.crawled).toBe(false);
    expect(scores.seoScore).toBeNull();
  });
});
