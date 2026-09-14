import { describe, it, expect } from "vitest";
import {
  getScoreGate,
  MAX_SCORE_ATTEMPTS,
  isBelowGate,
  buildGateFeedback,
  buildGateStory,
  ScoreGateError,
  type GateHistoryEntry,
  type GateStory,
} from "./score-gate";
import { scoreContent, type SeoScoreResult } from "./seo-scorer";
import { scoreAeoGeo } from "./aeo-geo";
import type { BlogImageSpec } from "./blog-images";

// ---------------------------------------------------------------------------
// The loop under test
//
// A faithful replica of the gated generation loop in
// src/app/api/generate-content/route.ts and src/lib/ai/team-task.ts: score
// both engines on every attempt, record the attempt in scoreHistory, break
// when the gate clears, regenerate with buildGateFeedback otherwise, and
// throw ScoreGateError once the attempt budget is exhausted. The model is
// injected so no LLM, DB, or image pipeline is involved.
//
// The too-short-body re-prompt branch of the route is intentionally omitted
// (MIN_BLOG_WORDS effectively 1 here) — history recording is the behavior
// under test, and that branch re-prompts BEFORE scoring so it never adds a
// history entry.
// ---------------------------------------------------------------------------

interface Draft {
  title: string;
  slug: string;
  metaDescription: string;
  body: string;
  images: BlogImageSpec[];
}

interface ModelCall {
  userPrompt: string;
  feedback: string;
}

const KEYWORD = "cold brew coffee";
const INTERNAL_URLS = ["https://site.com/menu"];

async function runGateLoop(
  model: (call: number, feedback: string) => Promise<Draft>,
  // Optional observer so tests can inspect the history even when the loop
  // exits by throwing ScoreGateError.
  capture?: (history: GateHistoryEntry[]) => void
) {
  const calls: ModelCall[] = [];
  const gate = getScoreGate();
  let attempts = 0;
  let fixFeedback = "";
  let draft: Draft | null = null;
  let seo: SeoScoreResult | null = null;
  let aeoGeoTotal = 0;
  const scoreHistory: GateHistoryEntry[] = [];

  // The capture runs in a finally so tests can inspect the history whether
  // the loop exits via the clearing break OR via ScoreGateError.
  try {
  while (true) {
    attempts += 1;
    draft = await model(attempts, fixFeedback);
    calls.push({ userPrompt: "write the post", feedback: fixFeedback });

    seo = scoreContent({
      title: draft.title,
      metaDescription: draft.metaDescription,
      slug: draft.slug,
      body: draft.body,
      keyword: KEYWORD,
      internalUrls: INTERNAL_URLS,
    });
    const aeo = scoreAeoGeo({
      title: draft.title,
      metaDescription: draft.metaDescription,
      body: draft.body,
      keyword: KEYWORD,
      entities: [],
    });
    aeoGeoTotal = aeo.total;

    const belowGate = isBelowGate(seo.total, aeo.total, gate);
    scoreHistory.push({ attempt: attempts, seo: seo.total, aeoGeo: aeo.total, belowGate });
    if (!belowGate) break;
    if (attempts >= MAX_SCORE_ATTEMPTS) {
      throw new ScoreGateError(seo.total, aeo.total, gate, seo, aeo);
    }
    fixFeedback = buildGateFeedback(seo, aeo, gate);
  }
  } finally {
    capture?.(scoreHistory);
  }

  // The response/payload contract consumed by the results card
  // (dashboard/generate/page.tsx) and persisted on the post's content.
  const gateStory = buildGateStory(gate, attempts, scoreHistory);
  const seoPayload = {
    score: seo!.total,
    grade: seo!.grade,
    keyword: seo!.keyword,
    wordCount: seo!.wordCount,
    checks: seo!.checks,
  };
  const aeoGeoPayload = {
    score: aeoGeoTotal,
    aeoScore: 0, // real loop reads aeo.aeoScore — only the shape matters here
    geoScore: 0,
    grade: "green" as const,
    checks: [],
    qaPairs: scoreAeoGeo({
      title: draft.title,
      metaDescription: draft.metaDescription,
      body: draft.body,
      keyword: KEYWORD,
      entities: [],
    }).qaPairs,
  };
  return { gateStory, seoPayload, aeoGeoPayload, calls };
}

// ---------------------------------------------------------------------------
// Fixtures — real scorers decide the gate, so the drafts must genuinely
// fail / clear it.
// ---------------------------------------------------------------------------

// Weak first draft: no keyword anywhere, no links, no images, no headings,
// no questions, no data points — fails most checks on BOTH engines.
const WEAK_DRAFT: Draft = {
  title: "Brewing",
  slug: "brewing",
  metaDescription: "Brewing stuff",
  body: `Coffee brewing is simple. Most people make coffee every day without thinking about it. There are many ways to brew. Some methods are faster than others. You can use a drip machine or a press. Every method has pros and cons.`,
  images: [],
};

// Fully optimized draft. Builds to ~950 words with: keyword in title/meta/
// slug/first-10%/body at healthy density, internal + outbound links, a
// keyword-bearing image alt, short paragraphs, H2/H3 subheadings, an FAQ
// section with extractable Q&A pairs, a numbered how-to, statistics, and
// authority language — clears both engines with room to spare.
function goodDraft(): Draft {
  const filler = [
    "The pitcher method keeps the brew clean and sediment-free. Combine coarsely ground beans and filtered water in a large jar, stir once, and let the mixture rest. Straining through a paper filter at the end polishes the final cup and gives it a tea-like clarity that many cafes chase. The result is a concentrate you can dilute to taste, which makes batch preparation easy for busy households and offices alike.",
    "Grind size matters more than most guides admit. Too fine and the long steep extracts bitter astringency; too coarse and the cup falls flat. Aim for a consistency like coarse sea salt. A burr grinder pays for itself quickly because the particle distribution stays even, and even particles are what make the extraction predictable from batch to batch.",
    "Water quality is the quiet variable. Filtered water with moderate mineral content highlights the chocolate and nut notes that define the style, while distilled water leaves the cup tasting hollow. If your tap water tastes like a swimming pool, filter it before brewing — the beans cannot mask what the water brings.",
    "Steep time is flexible. Eight hours gives a bright, tea-like cup, while sixteen to twenty hours pushes toward heavy chocolate and dried fruit. Many brewers split the difference at twelve hours for a balanced profile. Refrigerate the jar while it steeps to slow oxidation and keep the flavors fresh until you strain.",
    "Serving over ice dilutes the concentrate as it melts, so brew slightly stronger for iced drinks. A splash of milk or a wheel of citrus both work; the low acidity means cream curdles far less often than it does in hot coffee drinks, which is one reason the style became a summer staple on cafe menus.",
    "Storage is simple. The strained concentrate keeps for up to two weeks in a sealed bottle in the refrigerator, and the flavor actually rounds out after a day of rest. Label the bottle with the brew date so you can track when a batch peaks, and give it a gentle shake before pouring to recombine any settled oils.",
    "Cleaning up takes a minute. Rinse the filter, wash the jar, and wipe the grinder chute. Used grounds go straight to the compost or the garden roses, which appreciate the nitrogen. A clean setup keeps off-flavors out of the next batch and makes the whole ritual feel as easy as it tastes.",
    "Cost per cup drops fast once you brew at home. A bag of quality beans yields roughly a dozen servings, which undercuts cafe prices by a wide margin. The equipment list is short too: one jar, one filter, one grinder. There is no machine to descale and no capsule to throw away, which is why the method has stayed popular for decades.",
  ];

  const body = [
    `${cap(KEYWORD)} is a smooth brewing method where coarsely ground beans steep in cold water for 12 to 24 hours. According to a 2024 industry study, cold brew drinks drive 35% of cafe menu growth, and this guide explains why the style works and how to make it at home.`,
    `## Why does cold brew taste smoother?`,
    `Cold water extracts fewer bitter compounds than hot water, which is why the cup tastes naturally sweet. What ratio should you use? A 1:8 ratio produces concentrate and 1:15 produces ready-to-drink ${KEYWORD}.`,
    `![${cap(KEYWORD)} steeping in a glass pitcher](https://cdn.example.com/hero.jpg)`,
    ...filler.map((p, i) => `## ${FILLER_HEADINGS[i]}\n\n${p}${i % 2 === 0 ? ` Many home brewers keep ${KEYWORD} on tap all week because the concentrate is ready when they are.` : ""}`),
    `## How to make cold brew coffee at home`,
    `Follow these steps for a foolproof first batch:`,
    `1. Grind 100 grams of beans coarse.`,
    `2. Combine with 800 milliliters of filtered water in a jar.`,
    `3. Steep 12 to 24 hours, then strain through a paper filter.`,
    `## Frequently asked questions`,
    `Why does cold brew coffee taste smoother than hot coffee?`,
    `Cold extraction pulls fewer bitter acids, so the finished cup tastes sweeter without added sugar.`,
    `Can I reuse the grounds for a second batch?`,
    `You can, but the second batch is noticeably weaker — most brewers prefer fresh grounds for each steep.`,
    `Read the [cafe menu](https://site.com/menu) to compare our house recipe, and see the [origins of the method](https://en.wikipedia.org/wiki/Cold_brew) for the history.`,
  ].join("\n\n");

  return {
    title: `${cap(KEYWORD)}: The Complete Guide to Smooth Home Brewing`,
    slug: "cold-brew-coffee-guide",
    metaDescription: `${cap(KEYWORD)} explained: ratios, steep times, and the gear you need for a smooth cup.`,
    body,
    images: [],
  };
}

const FILLER_HEADINGS = [
  "The pitcher method",
  "Grind size",
  "Water quality",
  "Steep time",
  "Serving over ice",
  "Storage",
  "Cleanup",
  "Cost per cup",
];

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// The weak draft must genuinely fail both engines and the good draft must
// genuinely clear them — otherwise the loop tests below prove nothing.
describe("gate-loop fixtures", () => {
  it("weak draft scores below the gate on both engines", () => {
    const seo = scoreContent({
      title: WEAK_DRAFT.title,
      metaDescription: WEAK_DRAFT.metaDescription,
      slug: WEAK_DRAFT.slug,
      body: WEAK_DRAFT.body,
      keyword: KEYWORD,
      internalUrls: INTERNAL_URLS,
    });
    const aeo = scoreAeoGeo({
      title: WEAK_DRAFT.title,
      metaDescription: WEAK_DRAFT.metaDescription,
      body: WEAK_DRAFT.body,
      keyword: KEYWORD,
      entities: [],
    });
    expect(seo.total).toBeLessThan(80);
    expect(aeo.total).toBeLessThan(80);
  });

  it("good draft clears the gate on both engines", () => {
    const d = goodDraft();
    const seo = scoreContent({
      title: d.title,
      metaDescription: d.metaDescription,
      slug: d.slug,
      body: d.body,
      keyword: KEYWORD,
      internalUrls: INTERNAL_URLS,
    });
    const aeo = scoreAeoGeo({
      title: d.title,
      metaDescription: d.metaDescription,
      body: d.body,
      keyword: KEYWORD,
      entities: [],
    });
    expect(seo.total).toBeGreaterThanOrEqual(80);
    expect(aeo.total).toBeGreaterThanOrEqual(80);
    expect(aeo.qaPairs.length).toBeGreaterThanOrEqual(2);
  });
});

describe("generate-content score-gate loop (mocked model)", () => {
  it("clears on the first attempt and records a single passing history entry", async () => {
    const { gateStory, seoPayload, aeoGeoPayload, calls } = await runGateLoop(
      async () => goodDraft()
    );

    expect(calls).toHaveLength(1);
    expect(gateStory.gate).toBe(80);
    expect(gateStory.attempts).toBe(1);
    expect(gateStory.maxAttempts).toBe(MAX_SCORE_ATTEMPTS);
    expect(gateStory.retries).toBe(0);
    expect(gateStory.history).toHaveLength(1);
    expect(gateStory.history[0]).toEqual({
      attempt: 1,
      seo: seoPayload.score,
      aeoGeo: aeoGeoPayload.score,
      belowGate: false,
    });
  });

  it("records every regeneration and clears on the later attempt", async () => {
    const { gateStory, seoPayload, aeoGeoPayload, calls } = await runGateLoop(
      async (call) => (call === 1 ? WEAK_DRAFT : goodDraft())
    );

    // The model ran exactly twice: weak draft, then the gate-fixed rewrite.
    expect(calls).toHaveLength(2);
    // The retry prompt carried the failing checks verbatim as feedback,
    // including the first attempt's actual scores.
    expect(calls[1].feedback).toContain("Quality gate");
    expect(calls[1].feedback).toContain(`SEO ${gateStory.history[0].seo}/100`);
    expect(calls[1].feedback).toContain(`AEO/GEO ${gateStory.history[0].aeoGeo}/100`);
    expect(calls[1].feedback).toContain("Failing SEO checks:");
    expect(calls[1].feedback).toContain("Failing AEO/GEO checks:");
    expect(calls[1].feedback).toContain("Focus keyword in SEO title");

    // History records BOTH attempts, in order, with honest belowGate flags.
    expect(gateStory.attempts).toBe(2);
    expect(gateStory.retries).toBe(1);
    expect(gateStory.history).toHaveLength(2);
    const [first, second] = gateStory.history;
    expect(first).toMatchObject({ attempt: 1, belowGate: true });
    expect(second).toMatchObject({ attempt: 2, belowGate: false });
    expect(first.seo).toBeLessThan(80);
    expect(first.aeoGeo).toBeLessThan(80);
    // The regeneration actually improved the scores toward the gate.
    expect(second.seo).toBeGreaterThan(first.seo);
    expect(second.aeoGeo).toBeGreaterThan(first.aeoGeo);
    // Final payload scores are the CLEARING attempt's scores.
    expect(seoPayload.score).toBe(second.seo);
    expect(aeoGeoPayload.score).toBe(second.aeoGeo);
  });

  it("throws ScoreGateError after the attempt budget with a history entry per attempt", async () => {
    let capturedHistory: GateHistoryEntry[] = [];
    await expect(
      runGateLoop(async () => WEAK_DRAFT, (history) => {
        capturedHistory = history;
      })
    ).rejects.toThrow(ScoreGateError);

    // History captured every attempt, all honestly flagged below-gate.
    expect(capturedHistory).toHaveLength(MAX_SCORE_ATTEMPTS);
    expect(capturedHistory.map((h) => h.attempt)).toEqual([1, 2, 3, 4, 5]);
    expect(capturedHistory.every((h) => h.belowGate)).toBe(true);
    expect(capturedHistory.every((h) => h.seo < 80 && h.aeoGeo < 80)).toBe(true);
  });

  it("results-card payload shape matches the persisted contract", async () => {
    const { gateStory, seoPayload, aeoGeoPayload } = await runGateLoop(
      async (call) => (call === 1 ? WEAK_DRAFT : goodDraft())
    );

    // Gate story keys — exactly what page.tsx's GenerateResponse.gate reads.
    expect(Object.keys(gateStory).sort()).toEqual(
      ["attempts", "gate", "history", "maxAttempts", "retries"].sort()
    );
    gateStory.history.forEach((h) => {
      expect(Object.keys(h).sort()).toEqual(
        ["aeoGeo", "attempt", "belowGate", "seo"].sort()
      );
      expect(Number.isFinite(h.seo)).toBe(true);
      expect(Number.isFinite(h.aeoGeo)).toBe(true);
      expect(typeof h.belowGate).toBe("boolean");
    });
    // maxAttempts always reflects the documented retry budget.
    expect(gateStory.maxAttempts).toBe(5);
    expect(gateStory.retries).toBe(gateStory.attempts - 1);

    // seoPayload + aeoGeoPayload — the checklist shapes the cards render.
    expect(Object.keys(seoPayload).sort()).toEqual(
      ["checks", "grade", "keyword", "score", "wordCount"].sort()
    );
    expect(Object.keys(aeoGeoPayload).sort()).toEqual(
      ["aeoScore", "checks", "geoScore", "grade", "qaPairs", "score"].sort()
    );
    aeoGeoPayload.qaPairs.forEach((p) => {
      expect(Object.keys(p).sort()).toEqual(["a", "q"].sort());
      expect(p.q.length).toBeGreaterThan(0);
      expect(p.a.length).toBeGreaterThan(0);
    });

    // The story is persisted into the post's JSONB content — it must
    // round-trip JSON losslessly.
    const roundTrip = JSON.parse(JSON.stringify(gateStory)) as GateStory;
    expect(roundTrip).toEqual(gateStory);
  });
});
