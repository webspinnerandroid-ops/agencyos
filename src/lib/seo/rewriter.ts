/**
 * Text rewriter — paste any content and have it rewritten to clear the
 * SEO / AEO / GEO quality gate (80/80 by default).
 *
 * Pipeline per attempt:
 *   1. Score the current text with the same engines audits use (scoreContent
 *      + scoreAeoGeo via the analyzer's text mode).
 *   2. If it clears the gate (SEO >= gate AND AEO/GEO >= gate), stop.
 *   3. Otherwise, hand the EXACT failing checks to the model as rewrite
 *      guidance and ask for a new version — same approach the generation
 *      pipelines use (buildGateFeedback), so a rewrite fixes the real gaps.
 *   4. After MAX_SCORE_ATTEMPTS the text is returned as-is with the scores,
 *      so nothing sub-gate is ever force-saved.
 */

import { analyzeContent, type AnalyzeResult } from "@/lib/seo/analyzer";
import { generateText } from "@/lib/ai/orchestrator";
import {
  getScoreGate,
  isBelowGate,
  buildGateFeedback,
  MAX_SCORE_ATTEMPTS,
} from "@/lib/score-gate";
import type { RankMathResult } from "@/lib/rankmath";
import type { AeoGeoResult } from "@/lib/aeo-geo";

export interface RewriteRequest {
  /** Raw pasted text / markdown to rewrite. */
  text: string;
  /** Optional title — the rewrite keeps/improves it; derived otherwise. */
  title?: string;
  /** Optional focus keyword to write toward. */
  keyword?: string;
}

export interface RewriteAttempt {
  attempt: number;
  body: string;
  seo: RankMathResult | null;
  aeoGeo: AeoGeoResult | null;
  passed: boolean;
  feedback: string;
}

export interface RewriteResult {
  original: AnalyzeResult;
  originalBody: string;
  originalScores: { seo: number | null; aeoGeo: number | null; passed: boolean };
  final: AnalyzeResult;
  finalBody: string;
  finalScores: { seo: number | null; aeoGeo: number | null; passed: boolean };
  attempts: RewriteAttempt[];
  gate: number;
  passed: boolean;
  rewritten: boolean;
  keyword: string;
  title: string;
}

/** Score text-mode content through the analyzer's shared path. */
async function scoreText(
  text: string,
  title: string,
  keyword: string
): Promise<AnalyzeResult> {
  const result = await analyzeContent({ text, title, keyword });
  return result;
}

/**
 * Rewrite `input.text` until it clears the gate, returning every attempt's
 * scores so the UI can show the improvement curve.
 */
export async function rewriteToPassGate(
  input: RewriteRequest,
  opts?: { tenantId?: string }
): Promise<RewriteResult> {
  const gate = getScoreGate();
  const text = (input.text ?? "").trim();
  if (!text) throw new Error("Provide a piece of text to rewrite.");

  const title = (input.title ?? "").trim() || "Rewritten content";
  const keyword = (input.keyword ?? "").trim() || (input.title ?? "").trim() || "the topic";

  const original = await scoreText(text, title, keyword);
  const originalPassed =
    original.seo != null &&
    original.aeoGeo != null &&
    !isBelowGate(original.seo.total, original.aeoGeo.total, gate);

  const attempts: RewriteAttempt[] = [];
  let currentBody = text;
  let currentTitle = title;
  let final: AnalyzeResult = original;

  for (let attempt = 1; attempt <= MAX_SCORE_ATTEMPTS; attempt++) {
    const scored = await scoreText(currentBody, currentTitle, keyword);
    const passed =
      scored.seo != null &&
      scored.aeoGeo != null &&
      !isBelowGate(scored.seo.total, scored.aeoGeo.total, gate);

    attempts.push({
      attempt,
      body: currentBody,
      seo: scored.seo,
      aeoGeo: scored.aeoGeo,
      passed,
      feedback: "",
    });

    if (passed || attempt === MAX_SCORE_ATTEMPTS) {
      final = scored;
      break;
    }

    // Rewrite with the exact failing checks as guidance.
    const feedback = buildGateFeedback(
      scored.seo ?? (emptySeo() as unknown as RankMathResult),
      scored.aeoGeo ?? (emptyAeo() as unknown as AeoGeoResult),
      gate
    );
    attempts[attempts.length - 1].feedback = feedback;

    const systemPrompt = `You are an expert SEO / AEO / GEO content editor. Rewrite the provided content so it passes a strict quality gate: SEO score >= ${gate}/100 AND AEO/GEO score >= ${gate}/100.

Rules for every rewrite:
- Keep the same topic, primary keyword "${keyword}", and overall meaning — do not change facts or tone.
- Improve the structure: a clear opening definition, H2/H3 subheadings, short paragraphs (under 120 words).
- Include the primary keyword naturally in the title, first paragraph, a heading, and the meta description.
- Add a FAQ section with 3-5 direct question/answer pairs.
- Add concrete data points / statistics / years.
- Include at least one numbered how-to/step list.
- Include at least one outbound reference link.
- Preserve the author's original voice and any existing internal links.
- Return the REWRITTEN CONTENT in valid markdown, no extra commentary.`;

    const userPrompt = `ORIGINAL TITLE: ${currentTitle}\nPRIMARY KEYWORD: ${keyword}\n\n${feedback}\n\n## CURRENT CONTENT TO REWRITE\n${currentBody.slice(0, 24000)}`;

    try {
      const rewritten = await generateText("content_rewrite" as never, userPrompt, opts?.tenantId ?? "", {
        systemPrompt,
        temperature: 0.6,
        maxTokens: 4000,
      });
      const cleaned = (rewritten ?? "").trim();
      // The model may return a JSON-ish envelope; prefer markdown as-is.
      currentBody = cleaned || currentBody;
      // Try to lift an improved title from a leading markdown H1, else keep.
      const h1 = currentBody.match(/^#\s+(.+)$/m);
      if (h1) currentTitle = h1[1].trim().slice(0, 120) || currentTitle;
    } catch (err) {
      // A model failure must not lose the user's text — stop trying.
      console.warn("[rewriter] rewrite attempt failed:", (err as Error).message);
      final = scored;
      break;
    }
  }

  const finalScores = {
    seo: final.seo?.total ?? null,
    aeoGeo: final.aeoGeo?.total ?? null,
    passed:
      final.seo != null &&
      final.aeoGeo != null &&
      !isBelowGate(final.seo.total, final.aeoGeo.total, gate),
  };

  return {
    original,
    originalBody: text,
    originalScores: {
      seo: original.seo?.total ?? null,
      aeoGeo: original.aeoGeo?.total ?? null,
      passed: originalPassed,
    },
    final,
    finalBody: currentBody,
    finalScores,
    attempts,
    gate,
    passed: finalScores.passed,
    rewritten: finalScores.passed && !originalPassed,
    keyword,
    title: final.title || title,
  };
}

function emptySeo(): RankMathResult {
  return { total: 0, grade: "red", keyword: "", wordCount: 0, checks: [] };
}

function emptyAeo(): AeoGeoResult {
  return {
    total: 0,
    aeoScore: 0,
    geoSscore: 0,
    grade: "red",
    checks: [],
    qaPairs: [],
    wordCount: 0,
  };
}

/** Convenience: score arbitrary pasted text without rewriting. */
export async function scoreOnlyText(input: {
  text: string;
  title?: string;
  keyword?: string;
}): Promise<AnalyzeResult> {
  return analyzeContent({
    text: input.text,
    title: input.title,
    keyword: input.keyword,
  });
}
