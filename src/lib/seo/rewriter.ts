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

import { analyzeContent, deriveKeyword, type AnalyzeResult } from "@/lib/seo/analyzer";
import { generateText } from "@/lib/ai/orchestrator";
import {
  getScoreGate,
  isBelowGate,
  buildGateFeedback,
  MAX_SCORE_ATTEMPTS,
} from "@/lib/score-gate";
import type { SeoScoreResult } from "@/lib/seo-scorer";
import type { AeoGeoResult } from "@/lib/aeo-geo";

export interface RewriteRequest {
  /** Raw pasted text / markdown to rewrite. */
  text: string;
  /** Optional title — the rewrite keeps/improves it; derived otherwise. */
  title?: string;
  /** Optional focus keyword to write toward; auto-detected from the content otherwise. */
  keyword?: string;
  /**
   * Free-text edit instructions from the user ("make it punchier", "add a
   * pricing table"). Applied on top of the failing-check feedback.
   */
  instructions?: string;
  /**
   * Targeted mode: keep the current body essentially as-is and fix ONLY the
   * remaining failing checks (plus `instructions`), instead of a full rewrite.
   */
  targeted?: boolean;
}

export interface RewriteAttempt {
  attempt: number;
  body: string;
  seo: SeoScoreResult | null;
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
  /** Set when a model call failed — the original content is returned untouched. */
  rewriteError?: string;
}

/** Pull a meta description the model embedded as "Meta description: …". */
function extractMetaDescription(body: string): string {
  const m = body.match(/^Meta description[\s:—\-]+(.+)$/im);
  if (m && m[1].trim()) return m[1].trim().slice(0, 320);
  return "";
}

/** Derive a real title from the pasted content when the user gave none. */
function deriveTitleFromText(text: string, keyword: string): string {
  const h1 = text.match(/^#\s+(.+)$/m);
  if (h1 && h1[1].trim()) return h1[1].trim().slice(0, 120);
  const firstLine = (text ?? "")
    .split(/\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 20 && !/^[#!\[>*_`\-]/.test(l));
  if (firstLine) return firstLine.replace(/^#+\s*/, "").slice(0, 120);
  if (keyword) {
    return keyword.replace(/\b[a-z]/g, (c) => c.toUpperCase()).slice(0, 120);
  }
  return "Content";
}

/** Score text-mode content through the analyzer's shared path. */
async function scoreText(
  text: string,
  title: string,
  keyword: string,
  metaDescription = ""
): Promise<AnalyzeResult> {
  const result = await analyzeContent({
    text,
    title,
    keyword,
    metaDescription: metaDescription || undefined,
  });
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

  // Focus keyword comes from the content itself unless the user gave one —
  // never from a placeholder title ("Rewritten content" used to become the
  // keyword, which is exactly why rewrites drifted off-subject).
  const userTitle = (input.title ?? "").trim();
  const keyword = (input.keyword ?? "").trim() || deriveKeyword(userTitle, text);
  // A real title is required for scoring (title checks fail otherwise). If
  // none was provided, lift one from the content: a leading H1, the first
  // substantive line, or a title-cased keyword.
  const title = userTitle || deriveTitleFromText(text, keyword);

  const original = await scoreText(text, title, keyword);
  const originalPassed =
    original.seo != null &&
    original.aeoGeo != null &&
    !isBelowGate(original.seo.total, original.aeoGeo.total, gate);

  const attempts: RewriteAttempt[] = [];
  let currentBody = text;
  let currentTitle = title;
  let currentMeta = extractMetaDescription(text);
  let final: AnalyzeResult = original;
  let rewriteError: string | undefined;

  for (let attempt = 1; attempt <= MAX_SCORE_ATTEMPTS; attempt++) {
    const scored = await scoreText(currentBody, currentTitle, keyword, currentMeta);
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
      scored.seo ?? (emptySeo() as unknown as SeoScoreResult),
      scored.aeoGeo ?? (emptyAeo() as unknown as AeoGeoResult),
      gate
    );
    attempts[attempts.length - 1].feedback = feedback;

    const targetedLine = input.targeted
      ? `\nTARGETED EDIT MODE: Keep the current content essentially as written. Fix ONLY the failing checks listed above (plus any user edit instructions below) — do not rewrite the rest, do not change the topic, structure, or wording of the parts that already pass.`
      : "";

    const systemPrompt = `You are an expert SEO / AEO / GEO content editor. Rewrite the provided content so it passes a strict quality gate: SEO score >= ${gate}/100 AND AEO/GEO score >= ${gate}/100.

TOPIC LOCK (most important rule): The subject is FIXED by the ORIGINAL CONTENT. Stay strictly on that topic — the same product, service, question, or story the original is about. Never introduce a new subject, drift to a different angle, or turn the piece into something else. If the original is about "${keyword}", every sentence of the rewrite must be about "${keyword}".

Rules for every rewrite:
- Keep the same topic, primary keyword "${keyword}", and overall meaning — do not change facts or tone.
- WRITE AT LEAST 2,000 WORDS — a thin rewrite cannot pass the length check, so expand with thorough sections, examples, and actionable detail, all on the same topic.
- Begin with a single line exactly like: Meta description: <a 120-160 character description that contains the primary keyword>.
- Improve the structure: a clear opening definition, H2/H3 subheadings, short paragraphs (under 120 words).
- Include the primary keyword naturally in the title, first paragraph, a heading, and the meta description.
- Add a FAQ section with 3-5 direct question/answer pairs about the topic.
- Add concrete data points / statistics / years relevant to the topic.
- Include at least one numbered how-to/step list.
- Include 1-2 images as markdown, e.g. ![alt text containing the primary keyword](https://example.com/image.jpg) — the image alt MUST contain the keyword.
- Include at least one outbound reference link.
- Preserve the author's original voice and any existing internal links.
- Return the REWRITTEN CONTENT in valid markdown, no extra commentary.`;

    const userInstructions = (input.instructions ?? "").trim();
    const instructionBlock = userInstructions
      ? `\n\n## USER EDIT INSTRUCTIONS (follow these exactly, on top of the checks above)\n${userInstructions}`
      : "";

    const userPrompt = `ORIGINAL TITLE: ${currentTitle}\nPRIMARY KEYWORD: ${keyword}\n\n${feedback}${instructionBlock}${targetedLine}\n\n## CURRENT CONTENT TO REWRITE\n${currentBody.slice(0, 24000)}`;

    try {
      const rewritten = await generateText("content_rewrite", userPrompt, opts?.tenantId ?? "", {
        systemPrompt,
        temperature: 0.6,
        maxTokens: 8000,
      });
      const cleaned = (rewritten ?? "").trim();
      // The model may return a JSON-ish envelope; prefer markdown as-is.
      currentBody = cleaned || currentBody;
      // Lift the meta description the model embedded (feeds the meta check),
      // then an improved title from a leading markdown H1, else keep both.
      currentMeta = extractMetaDescription(currentBody) || currentMeta;
      const h1 = currentBody.match(/^#\s+(.+)$/m);
      if (h1) currentTitle = h1[1].trim().slice(0, 120) || currentTitle;
    } catch (err) {
      // A model failure must not lose the user's text — stop trying and tell
      // the caller why instead of silently returning the unchanged original.
      const message = err instanceof Error ? err.message : "AI provider error";
      console.warn("[rewriter] rewrite attempt failed:", message);
      final = scored;
      rewriteError = message;
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
    rewriteError,
  };
}

function emptySeo(): SeoScoreResult {
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
