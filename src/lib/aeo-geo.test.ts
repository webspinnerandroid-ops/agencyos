import { describe, it, expect } from "vitest";
import { scoreAeoGeo, extractQaPairs, resolveAeoGeoScore } from "./aeo-geo";

const strongBody = `
# What Is Answer Engine Optimization?

Answer engine optimization (AEO) is the practice of structuring content so AI
assistants like ChatGPT, Gemini, and Claude cite it accurately. It means writing
clear definitions, answering questions directly, and adding structured data.

## Why does AEO matter?

Because 62% of searches now end without a click, and AI answer engines are the
new front door. Studies show 3 in 4 users trust AI answers.

## How to optimize for answer engines?

1. Write a one-sentence definition in the first paragraph.
2. Add an FAQ section with direct Q&A pairs.
3. Include statistics and cite authoritative sources like industry standards.
4. Mark up content with FAQPage schema.

## Frequently asked questions

**What is AEO?** It is the practice of optimizing content for AI answer engines.
**How long does it take?** Most sites see results within 3 to 6 months according to research.
`;

const weakBody = `
Welcome to our website. We are a company. We do things for people. Please
contact us for more information about our services and products. We have been
in business for a while. We care about our customers. Call us today.
`;

describe("scoreAeoGeo", () => {
  it("scores strong answer-optimized content above 70", () => {
    const r = scoreAeoGeo({
      title: "What Is Answer Engine Optimization?",
      metaDescription: "Answer engine optimization explained.",
      body: strongBody,
      keyword: "answer engine optimization",
      entities: ["ChatGPT", "Gemini", "Claude"],
      hasFaqSchema: true,
    });
    expect(r.total).toBeGreaterThanOrEqual(70);
    expect(r.grade).toBe("green");
    expect(r.qaPairs.length).toBeGreaterThanOrEqual(2);
  });

  it("scores thin generic content below 40", () => {
    const r = scoreAeoGeo({
      title: "Welcome",
      metaDescription: "About us",
      body: weakBody,
      keyword: "our company",
    });
    expect(r.total).toBeLessThan(40);
    expect(r.aeoScore).toBeLessThan(30);
  });

  it("extracts Q&A pairs from markdown", () => {
    const pairs = extractQaPairs(strongBody);
    const qs = pairs.map((p) => p.q);
    expect(qs.some((q) => q.includes("Why does AEO matter"))).toBe(true);
    expect(pairs.every((p) => p.a.length > 0)).toBe(true);
  });
});

describe("resolveAeoGeoScore (hybrid)", () => {
  it("returns the heuristic result by default (no LLM cost)", async () => {
    const { result, source } = await resolveAeoGeoScore({
      title: "What Is Answer Engine Optimization?",
      metaDescription: "Answer engine optimization explained.",
      body: strongBody,
      keyword: "answer engine optimization",
    });
    expect(source).toBe("heuristic");
    expect(result.total).toBeGreaterThanOrEqual(0);
  });

  it("falls back to heuristic when LLM mode is requested without a tenant key", async () => {
    const { source, result } = await resolveAeoGeoScore(
      {
        title: "What Is Answer Engine Optimization?",
        metaDescription: "Answer engine optimization explained.",
        body: strongBody,
        keyword: "answer engine optimization",
      },
      { useLlm: true, tenantId: "00000000-0000-0000-0000-000000000001" }
    );
    // No text provider key exists for this fake tenant, so the LLM pass
    // fails cleanly and the heuristic result is returned instead.
    expect(source).toBe("heuristic");
    expect(result.checks.length).toBeGreaterThan(0);
  });
});
