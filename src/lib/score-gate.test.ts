import { describe, it, expect, afterEach } from "vitest";
import {
  getScoreGate,
  MAX_SCORE_ATTEMPTS,
  isBelowGate,
  buildGateFeedback,
  ScoreGateError,
  mapReusedImages,
} from "./score-gate";
import { scoreContent, type SeoScoreResult } from "./seo-scorer";
import { scoreAeoGeo, type AeoGeoResult } from "./aeo-geo";
import type { BlogImageSpec, GeneratedBlogImage } from "./blog-images";

// A deliberately weak draft: no keyword, no links, no images, no headings, no
// questions, no data points — fails most checks on BOTH engines, which is what
// the gate-feedback and error tests need.
const badBody = `Coffee brewing is simple. Most people make coffee every day without thinking about it. There are many ways to brew. Some methods are faster than others. You can use a drip machine or a press. Every method has pros and cons.`;

function failingFixtures(): { seo: SeoScoreResult; aeo: AeoGeoResult } {
  return {
    seo: scoreContent({
      title: "Brewing",
      metaDescription: "Brewing stuff",
      slug: "brewing",
      body: badBody,
      keyword: "specialty coffee beans",
      internalUrls: ["https://site.com/about"],
    }),
    aeo: scoreAeoGeo({
      title: "Brewing",
      metaDescription: "Brewing stuff",
      body: badBody,
      keyword: "specialty coffee beans",
      entities: [],
    }),
  };
}

describe("getScoreGate", () => {
  afterEach(() => {
    delete process.env.SEO_SCORE_PUBLISH_MIN;
  });

  it("defaults to 80", () => {
    expect(getScoreGate()).toBe(80);
  });

  it("reads the shared env knob", () => {
    process.env.SEO_SCORE_PUBLISH_MIN = "75";
    expect(getScoreGate()).toBe(75);
  });

  it("falls back to 80 for invalid values", () => {
    process.env.SEO_SCORE_PUBLISH_MIN = "abc";
    expect(getScoreGate()).toBe(80);
    process.env.SEO_SCORE_PUBLISH_MIN = "-5";
    expect(getScoreGate()).toBe(80);
    process.env.SEO_SCORE_PUBLISH_MIN = "150";
    expect(getScoreGate()).toBe(80);
  });
});

describe("isBelowGate", () => {
  it("requires BOTH engines to clear the gate", () => {
    expect(isBelowGate(90, 90, 80)).toBe(false);
    expect(isBelowGate(90, 79, 80)).toBe(true);
    expect(isBelowGate(79, 90, 80)).toBe(true);
    expect(isBelowGate(80, 80, 80)).toBe(false);
  });
});

describe("buildGateFeedback", () => {
  it("lists the failing checks verbatim from both engines", () => {
    const { seo, aeo } = failingFixtures();
    const feedback = buildGateFeedback(seo, aeo, 80);
    expect(feedback).toContain(`SEO ${seo.total}/100`);
    expect(feedback).toContain(`AEO/GEO ${aeo.total}/100`);
    expect(feedback).toContain("80/100 on BOTH");
    expect(feedback).toContain("Failing SEO checks:");
    expect(feedback).toContain("Failing AEO/GEO checks:");
    // The failing fixtures fail the keyword-in-title and question-coverage
    // checks, so those labels must appear verbatim.
    expect(feedback).toContain("Focus keyword in SEO title");
    expect(feedback).toContain("Question language coverage");
  });
});

describe("ScoreGateError", () => {
  it("carries scores, gate, and structured failing checks", () => {
    const { seo, aeo } = failingFixtures();
    const err = new ScoreGateError(seo.total, aeo.total, 80, seo, aeo);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ScoreGateError");
    expect(err.seo).toBe(seo.total);
    expect(err.aeoGeo).toBe(aeo.total);
    expect(err.gate).toBe(80);
    expect(err.checks.length).toBeGreaterThan(0);
    expect(err.checks[0]).toHaveProperty("engine");
    expect(err.checks[0]).toHaveProperty("label");
    expect(err.checks[0]).toHaveProperty("detail");
    expect(err.message).toContain("below the quality gate");
    expect(err.message).toContain("Focus keyword in SEO title");
  });
});

describe("mapReusedImages", () => {
  const spec = (i: number): BlogImageSpec => ({
    prompt: `prompt ${i}`,
    placement: i === 0 ? "featured" : "inline",
    sectionTitle: `section ${i}`,
    description: `alt ${i}`,
  });
  const oldImages: GeneratedBlogImage[] = [
    { spec: spec(0), url: "https://cdn/0" },
    { spec: spec(1), url: "https://cdn/1" },
    { spec: spec(2), url: "https://cdn/2" },
  ];

  it("pairs new specs with old URLs by index (both featured-first)", () => {
    const out = mapReusedImages([spec(0), spec(1)], oldImages);
    expect(out).toHaveLength(2);
    expect(out[0].url).toBe("https://cdn/0");
    expect(out[0].spec.description).toBe("alt 0");
    expect(out[1].url).toBe("https://cdn/1");
  });

  it("drops new specs with no reusable image", () => {
    const out = mapReusedImages([spec(0), spec(1), spec(2), spec(3)], oldImages);
    expect(out).toHaveLength(3);
    expect(out[2].url).toBe("https://cdn/2");
  });

  it("returns nothing when there are no old images", () => {
    expect(mapReusedImages([spec(0)], [])).toHaveLength(0);
  });
});

it("exposes the documented retry budget", () => {
  expect(MAX_SCORE_ATTEMPTS).toBe(3); // 1 draft + 2 gate retries
});
