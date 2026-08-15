// src/lib/score-gate.ts
// The content quality gate — every generated AND rewritten piece of content
// must clear the same bar on BOTH engines before it is allowed to land:
//   SEO >= gate  AND  AEO/GEO >= gate
// Previously the gate only ran at publish time (src/app/api/publish/route.ts
// blocks below-threshold blogs). This module moves the gate INTO the
// generation pipelines (manual generate-content route, AI-team
// cherylGenerateBlog, and every rewrite path) so sub-standard content is
// fixed — or rejected with a clear explanation — instead of being silently
// saved and only caught later at publish.
//
// One knob controls the whole system: SEO_SCORE_PUBLISH_MIN (default 80),
// the same env var the publish gate has always used.

import type { RankMathResult } from "@/lib/rankmath";
import type { AeoGeoResult } from "@/lib/aeo-geo";
import type { BlogImageSpec, GeneratedBlogImage } from "@/lib/blog-images";

/** Extra generation attempts after the first draft misses the gate. */
export const MAX_SCORE_RETRIES = 2;

/** Total generation attempts allowed before the gate rejects the content. */
export const MAX_SCORE_ATTEMPTS = 1 + MAX_SCORE_RETRIES;

/** Env-configurable gate, shared with the publish route (default 80). */
export function getScoreGate(): number {
  const raw = Number(process.env.SEO_SCORE_PUBLISH_MIN);
  return Number.isFinite(raw) && raw >= 0 && raw <= 100 ? raw : 80;
}

/** A blog clears the gate only when BOTH engines clear it. */
export function isBelowGate(seo: number, aeoGeo: number, gate: number): boolean {
  return Math.min(seo, aeoGeo) < gate;
}

export interface GateCheckFailure {
  engine: "SEO" | "AEO/GEO";
  pillar?: "AEO" | "GEO";
  label: string;
  detail: string;
}

/**
 * Thrown after MAX_SCORE_ATTEMPTS when content still cannot clear the gate.
 * Carries the scores and the failing checks so API routes can return a
 * structured, actionable error instead of a bare 500. The draft is NOT
 * saved — no sub-gate content ever lands.
 */
export class ScoreGateError extends Error {
  readonly seo: number;
  readonly aeoGeo: number;
  readonly gate: number;
  readonly checks: GateCheckFailure[];

  constructor(
    seo: number,
    aeoGeo: number,
    gate: number,
    seoResult: RankMathResult,
    aeoResult: AeoGeoResult
  ) {
    const checks: GateCheckFailure[] = [
      ...seoResult.checks
        .filter((c) => !c.passed)
        .map((c) => ({ engine: "SEO" as const, label: c.label, detail: c.detail })),
      ...aeoResult.checks
        .filter((c) => !c.passed)
        .map((c) => ({
          engine: "AEO/GEO" as const,
          pillar: c.pillar,
          label: c.label,
          detail: c.detail,
        })),
    ];
    const top = checks
      .slice(0, 8)
      .map((f) => `- [${f.engine}] ${f.label}: ${f.detail}`)
      .join("\n");
    super(
      `Content scored below the quality gate: SEO ${seo}/100 and AEO/GEO ${aeoGeo}/100 (must clear ${gate}/100 on BOTH). It was regenerated ${MAX_SCORE_RETRIES} time(s) to fix this. Failing checks:\n${top}`
    );
    this.name = "ScoreGateError";
    this.seo = seo;
    this.aeoGeo = aeoGeo;
    this.gate = gate;
    this.checks = checks;
  }
}

/**
 * Build the targeted rewrite instruction for a gate retry: the failing
 * checks from the scorers, verbatim, so the model fixes the actual gaps
 * (keyword placement, length, links, alt text, Q&A, data points, …) instead
 * of guessing. Appended to the generation prompt's user message.
 */
export function buildGateFeedback(
  seoResult: RankMathResult,
  aeoResult: AeoGeoResult,
  gate: number
): string {
  const seoFails = seoResult.checks.filter((c) => !c.passed);
  const aeoFails = aeoResult.checks.filter((c) => !c.passed);
  const lines: string[] = [
    `## Quality gate — your previous draft scored below the required minimum`,
    `(SEO ${seoResult.total}/100, AEO/GEO ${aeoResult.total}/100; must clear ${gate}/100 on BOTH).`,
    `Rewrite the post now to fix EVERY failing check below. Keep the same topic, primary keyword, and title intent.`,
  ];
  if (seoFails.length > 0) {
    lines.push("", "Failing SEO checks:");
    for (const c of seoFails) lines.push(`- ${c.label}: ${c.detail}`);
  }
  if (aeoFails.length > 0) {
    lines.push("", "Failing AEO/GEO checks:");
    for (const c of aeoFails) lines.push(`- [${c.pillar}] ${c.label}: ${c.detail}`);
  }
  lines.push(
    "",
    "Remember: the post's SEO title, meta description, slug, first paragraph, and image descriptions (alt text) must contain the primary keyword; keep every paragraph under 120 words; use H2/H3 subheadings; include at least one internal and one outbound link; open with a crisp definitional sentence; and include concrete data points, direct question/answer phrasing, and a numbered how-to/step section."
  );
  return lines.join("\n");
}

/**
 * On a score-gate retry we regenerate the TEXT — which drives every scoring
 * check — but reuse the images already generated on the first attempt, since
 * image calls are the slow/expensive part of the pipeline. Both lists are
 * featured-first sorted (selectBlogImageSpecs), so pairing by index is
 * stable. The NEW specs carry the retry draft's (keyword-bearing)
 * descriptions, so the injected alt text reflects the fixed body. Specs with
 * no reusable image are dropped (their placeholders get stripped).
 */
export function mapReusedImages(
  newSpecs: BlogImageSpec[],
  oldImages: GeneratedBlogImage[]
): GeneratedBlogImage[] {
  const out: GeneratedBlogImage[] = [];
  newSpecs.forEach((spec, i) => {
    const url = oldImages[i]?.url;
    if (url) out.push({ spec, url });
  });
  return out;
}
