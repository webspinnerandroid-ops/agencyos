/**
 * AEO / GEO scoring engine.
 *
 * AEO (Answer Engine Optimization) measures how well content answers the
 * questions people actually ask AI answer engines (ChatGPT, Gemini, Claude,
 * Perplexity, Google AI Overviews). GEO (Generative Engine Optimization)
 * measures how likely a generative engine is to cite the content as a source.
 *
 * Like the Rank Math-style scorer, this is a pure, dependency-free heuristic
 * engine — no LLM calls, so it can run on every piece of content at zero
 * marginal cost. Scores surface alongside the existing SEO score on content.
 *
 * Scoring pillars (100 points):
 *
 *   AEO — Answer readiness (50)
 *     - Q&A coverage: question words + question marks + direct-answer phrasing
 *     - Structured answers: "X is Y" definitional sentences near the top
 *     - FAQ presence: h2/h3 "..." heading or bulleted Q&A pairs
 *     - Entity naming: company/product names + "what/why/how" coverage
 *     - Contextual completeness: mentions of "how to", "steps", numbers
 *
 *   GEO — Citation readiness (50)
 *     - Source signals: data points, statistics, dates, named studies
 *     - Schema signals: FAQPage/Article JSON-LD or schema-able structure
 *     - Clear claims: definitive statements, citations, authoritative tone
 *     - Internal/external references: link density + anchor specificity
 *     - Freshness + authority signals: dates, author, domain mention
 */

export interface AeoGeoCheck {
  id: string;
  label: string;
  pillar: "AEO" | "GEO";
  maxPoints: number;
  earned: number;
  passed: boolean;
  detail: string;
}

export interface AeoGeoResult {
  total: number;
  aeoScore: number;
  geoSscore: number;
  grade: "red" | "yellow" | "green";
  checks: AeoGeoCheck[];
  /** Extracted candidate Q&A pairs (for the answer library / FAQ schema). */
  qaPairs: { q: string; a: string }[];
  wordCount: number;
}

export interface AeoGeoInput {
  title: string;
  metaDescription: string;
  /** Markdown body. */
  body: string;
  /** Primary keyword / topic. */
  keyword: string;
  /** Optional extracted entities (company name, product names, locations). */
  entities?: string[];
  /** Whether FAQPage schema already exists in the content's JSON-LD. */
  hasFaqSchema?: boolean;
  /** Whether Article schema exists. */
  hasArticleSchema?: boolean;
}

// Reuse the rankmath plain-text helpers so parsing stays consistent.
import { plainText, countWords } from "./rankmath";

// The heuristic engine above is the free, always-on default. For editors who
// want deeper judgment, scoreAeoGeoWithLLM / resolveAeoGeoScore add an
// OPT-IN LLM-assisted pass. It is never called implicitly on the high-volume
// path (every generated post) — only where the caller explicitly opts in
// (e.g. a "deep check" action or an admin-enabled publish gate), so LLM cost
// stays opt-in. If the LLM call fails or no key is configured, it falls back
// to the heuristic result transparently.

const QUESTION_WORDS = ["what", "why", "how", "when", "where", "who", "which", "can", "do", "does", "is", "are"];
const DEFINITION_PATTERNS = /\bis\b|\bmeans\b|\brefers to\b|\bdefined as\b|\bconsists of\b|\bcomprises\b/i;
// Statistics: percentages, ratios ("3 in 4"), amounts, durations ("3 to 6 months"), years.
const STAT_PATTERNS =
  /\b\d+(?:\.\d+)?\s*(?:%|percent|million|billion|k|m)\b|\b\d+\s+in\s+\d+\b|\b\d{4}\b|\b\d+(?:\.\d+)?\s*(?:to|and)\s*\d+\s*(?:months|years|days|hours)\b/i;
const STEP_PATTERNS = /\b(step|steps|how to|guide|tutorial|process|checklist)\b/i;
const CONFIDENCE_PATTERNS = /\b(authoritative|industry-standard|peer-reviewed|study|research|according to|citation)\b/i;

function sectionHeadings(body: string): string[] {
  return [...body.matchAll(/^#{1,3}\s+(.+)$/gm)].map((m) => m[1].trim());
}

/** Naive extraction of question→answer pairs from markdown (for the answer library). */
export function extractQaPairs(body: string, max = 8): { q: string; a: string }[] {
  const pairs: { q: string; a: string }[] = [];
  const lines = body
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);

  for (let i = 0; i < lines.length && pairs.length < max; i++) {
    const line = lines[i];
    // A line ending in '?' — including heading-form questions like
    // "## Why does X matter?" (common in real content). Strip the markers.
    const cleanLine = line.replace(/^#{1,6}\s*/, "").replace(/^[-*]\s*/, "");
    const isQuestion =
      /\?\s*$/.test(cleanLine) && !cleanLine.startsWith("#");
    if (!isQuestion) continue;
    // Answer = next non-heading, non-question line (up to 200 chars).
    for (let j = i + 1; j < lines.length; j++) {
      const cand = lines[j];
      if (cand.startsWith("#")) break;
      if (/\?\s*$/.test(cand)) break;
      const answer = cand.replace(/^[-*]\s*/, "").slice(0, 200);
      if (answer) {
        pairs.push({ q: cleanLine, a: answer });
        break;
      }
    }
  }
  return pairs;
}

export function scoreAeoGeo(input: AeoGeoInput): AeoGeoResult {
  const text = plainText(input.body);
  const lower = text.toLowerCase();
  const words = countWords(text);
  const titleLower = input.title.toLowerCase();
  const kw = input.keyword.toLowerCase().trim();
  const headings = sectionHeadings(input.body);
  const headingLower = headings.join(" ").toLowerCase();
  const entities = input.entities ?? [];

  const checks: AeoGeoCheck[] = [];

  const push = (
    id: string,
    label: string,
    pillar: "AEO" | "GEO",
    maxPoints: number,
    passed: boolean,
    detail: string,
    multiplier?: number
  ) => {
    const m = multiplier ?? (passed ? 1 : 0);
    checks.push({
      id,
      label,
      pillar,
      maxPoints,
      earned: Math.round(m * maxPoints),
      passed: m >= 1,
      detail,
    });
  };

  // ---- AEO pillar (50) ----
  const qWordHits = QUESTION_WORDS.filter((w) => lower.includes(" " + w + " ") || lower.includes(w + "?"));
  push(
    "aeo_question_coverage",
    "Question language coverage",
    "AEO",
    12,
    qWordHits.length >= 4,
    `Covers ${qWordHits.length}/8 question word families${qWordHits.length < 4 ? " — add sections that answer \"what/why/how\" directly" : ""}.`,
    qWordHits.length >= 4 ? 1 : qWordHits.length >= 2 ? 0.5 : 0
  );

  const questionCount = (text.match(/\?/g) ?? []).length;
  push(
    "aeo_direct_questions",
    "Direct questions in body",
    "AEO",
    10,
    questionCount >= 1,
    questionCount >= 1
      ? `${questionCount} explicit question(s) the content answers.`
      : "No '?' questions found — answer engines look for explicit Q&A.",
    questionCount >= 2 ? 1 : questionCount === 1 ? 0.5 : 0
  );

  const qaPairs = extractQaPairs(input.body);
  push(
    "aeo_qa_pairs",
    "Q&A pairs extracted",
    "AEO",
    10,
    qaPairs.length >= 2,
    `${qaPairs.length} question→answer pairs detected${qaPairs.length < 2 ? " (2+ feed the answer library / FAQ schema)" : ""}.`,
    qaPairs.length >= 2 ? 1 : qaPairs.length === 1 ? 0.5 : 0
  );

  const keywordInTop = lower.slice(0, Math.max(300, Math.floor(lower.length * 0.1))).includes(kw);
  const keywordInQuarter = lower.slice(0, Math.max(300, Math.floor(lower.length * 0.25))).includes(kw);
  push(
    "aeo_keyword_early",
    "Keyword answered in first 10%",
    "AEO",
    8,
    keywordInTop,
    keywordInTop
      ? "Primary keyword appears in the opening definitional section."
      : keywordInQuarter
        ? "Keyword appears in the first quarter of the content."
        : "Answer engines read the intro first — put a definition with the keyword near the top.",
    keywordInTop ? 1 : keywordInQuarter ? 0.5 : 0
  );

  const definitional = DEFINITION_PATTERNS.test(text.slice(0, Math.max(400, Math.floor(text.length * 0.15))));
  const definitionalAnywhere = DEFINITION_PATTERNS.test(text.slice(0, Math.max(800, Math.floor(text.length * 0.4))));
  push(
    "aeo_definitional_intro",
    "Definitional introduction",
    "AEO",
    6,
    definitional,
    definitional
      ? "Opening uses \"is / means / refers to\" definitional phrasing."
      : definitionalAnywhere
        ? "Definitional phrasing appears later in the content — move it to the opening."
        : "Open with a crisp one-sentence definition of the topic.",
    definitional ? 1 : definitionalAnywhere ? 0.5 : 0
  );

  const faqHeading = headingLower.includes("faq") || headingLower.includes("frequently asked");
  const entityHits = entities.filter((e) => lower.includes(e.toLowerCase())).length;
  push(
    "aeo_entities",
    "Entity coverage",
    "AEO",
    4,
    entityHits >= 1 || (entities.length === 0 && qWordHits.length >= 3),
    entities.length
      ? `${entityHits}/${entities.length} known entities named${entityHits === 0 ? " — name your company/product explicitly" : ""}.`
      : "No entities supplied — coverage inferred from question language."
  );

  // ---- GEO pillar (50) ----
  const statHits = (lower.match(STAT_PATTERNS) ?? []).length;
  push(
    "geo_data_points",
    "Data & statistics",
    "GEO",
    14,
    statHits >= 1,
    `${statHits} data point(s) (%, counts, years)${statHits === 0 ? " — generative engines prefer content with concrete numbers to cite" : ""}.`,
    statHits >= 2 ? 1 : statHits === 1 ? 0.5 : 0
  );

  const schemaReady = input.hasFaqSchema || input.hasArticleSchema || faqHeading || qaPairs.length >= 2;
  push(
    "geo_schema_readiness",
    "Schema readiness (FAQ/Article)",
    "GEO",
    12,
    schemaReady,
    input.hasFaqSchema || input.hasArticleSchema
      ? "Structured data already present."
      : faqHeading || qaPairs.length >= 2
      ? "Q&A structure present — an FAQPage schema can be generated automatically."
      : "Add an FAQ section or Q&A pairs so FAQPage schema can be generated.",
    input.hasFaqSchema || input.hasArticleSchema ? 1 : faqHeading || qaPairs.length >= 2 ? 0.75 : qaPairs.length === 1 ? 0.4 : 0
  );

  const steps = STEP_PATTERNS.test(lower);
  const stepHits =
    (lower.match(STEP_PATTERNS) ?? []).length +
    (text.match(/^\s*\d+\.\s+/gm) ?? []).length;
  push(
    "geo_step_structure",
    "Structured steps / how-to",
    "GEO",
    8,
    steps,
    steps ? "How-to / step structure detected — strong for AI citation." : "Add a numbered step list or how-to section.",
    stepHits >= 2 ? 1 : steps ? 0.5 : 0
  );

  const confidence = CONFIDENCE_PATTERNS.test(lower);
  const confidenceHits = (lower.match(CONFIDENCE_PATTERNS) ?? []).length;
  push(
    "geo_authority_signals",
    "Authority signals",
    "GEO",
    8,
    confidence,
    confidence ? "Authoritative language (studies, citations, standards) present." : "Cite a study, standard, or authoritative source to boost credibility.",
    confidenceHits >= 2 ? 1 : confidence ? 0.5 : 0
  );

  const linkCount = (input.body.match(/\]\(https?:\/\//g) ?? []).length;
  push(
    "geo_references",
    "Reference links",
    "GEO",
    8,
    linkCount >= 1,
    `${linkCount} outbound reference link(s)${linkCount === 0 ? " — cite sources with links so engines can verify claims" : ""}.`,
    linkCount >= 2 ? 1 : linkCount === 1 ? 0.5 : 0
  );

  const aeoChecks = checks.filter((c) => c.pillar === "AEO");
  const geoChecks = checks.filter((c) => c.pillar === "GEO");
  const aeoScore = Math.round(aeoChecks.reduce((s, c) => s + c.earned, 0));
  const geoSscore = Math.round(geoChecks.reduce((s, c) => s + c.earned, 0));
  const total = aeoScore + geoSscore;
  const grade = total < 50 ? "red" : total <= 80 ? "yellow" : "green";

  return { total, aeoScore, geoSscore, grade, checks, qaPairs, wordCount: words };
}

// ============================================================================
// Hybrid LLM-assisted mode (opt-in)
// ============================================================================

interface LlmAeoGeoOutput {
  total: number;
  aeoScore: number;
  geoScore: number;
  grade: "red" | "yellow" | "green";
  checks: AeoGeoCheck[];
  qaPairs: { q: string; a: string }[];
}

/**
 * LLM-assisted AEO/GEO scoring. Uses the configured text model to judge the
 * same pillars with real intent/authority reasoning instead of heuristics.
 * Returns null if no text provider key is configured or the call fails —
 * callers fall back to the free heuristic.
 */
export async function scoreAeoGeoWithLLM(
  input: AeoGeoInput,
  tenantId: string
): Promise<AeoGeoResult | null> {
  try {
    const { generateStructuredOutput } = await import("./ai/orchestrator");
    const text = plainText(input.body);
    const preview =
      input.body.length > 18_000 ? input.body.slice(0, 18_000) + "\n\n[…truncated]" : input.body;

    const output = await generateStructuredOutput<LlmAeoGeoOutput>(
      "team_chat",
      `You are an AEO/GEO scoring analyst. Score this content for Answer Engine
Optimization (how well AI answer engines like ChatGPT/Gemini/Claude can extract
a direct answer) and Generative Engine Optimization (how likely they are to cite
it). Judge with real reasoning: does the opening define the topic and answer the
keyword intent? Are claims specific, sourced, current? Would an AI confidently
quote it?

Return JSON only:
- "total": 0-100 overall score
- "aeoScore": 0-50 (answer readiness: direct answers, Q&A, definition, entities)
- "geoScore": 0-50 (citation readiness: data, sources, authority, freshness)
- "grade": "red" (0-49) | "yellow" (50-80) | "green" (81-100)
- "checks": array of { id, label, pillar: "AEO"|"GEO", maxPoints, earned, passed, detail } —
  maxPoints should sum to 100, one entry per finding (4-8 entries)
- "qaPairs": array of { q, a } — the best question/answer pairs for the answer
  library (2-5 pairs, each answer <= 200 chars)`,
      `Title: ${input.title}
Meta: ${input.metaDescription || "(none)"}
Primary keyword: ${input.keyword || "(none)"}
Entities: ${(input.entities ?? []).join(", ") || "(none)"}
FAQ schema present: ${input.hasFaqSchema ?? false}

CONTENT:
${preview}`,
      tenantId,
      {
        type: "object",
        properties: {
          total: { type: "number" },
          aeoScore: { type: "number" },
          geoScore: { type: "number" },
          grade: { type: "string", enum: ["red", "yellow", "green"] },
          checks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                label: { type: "string" },
                pillar: { type: "string", enum: ["AEO", "GEO"] },
                maxPoints: { type: "number" },
                earned: { type: "number" },
                passed: { type: "boolean" },
                detail: { type: "string" },
              },
              required: ["id", "label", "pillar", "maxPoints", "earned", "passed", "detail"],
            },
          },
          qaPairs: {
            type: "array",
            items: {
              type: "object",
              properties: { q: { type: "string" }, a: { type: "string" } },
              required: ["q", "a"],
            },
          },
        },
        required: ["total", "aeoScore", "geoScore", "grade", "checks", "qaPairs"],
      },
      { temperature: 0.2, maxTokens: 1600, functionName: "score_aeo_geo" }
    );

    const checks = Array.isArray(output.checks) ? output.checks : [];
    const qaPairs = Array.isArray(output.qaPairs) ? output.qaPairs.slice(0, 8) : [];
    const total = Math.max(0, Math.min(100, Math.round(Number(output.total) || 0)));
    const aeoScore = Math.max(0, Math.min(50, Math.round(Number(output.aeoScore) || 0)));
    const geoScore = Math.max(0, Math.min(50, Math.round(Number(output.geoScore) || 0)));
    const grade =
      output.grade === "red" || output.grade === "green" || output.grade === "yellow"
        ? output.grade
        : total < 50
        ? "red"
        : total <= 80
        ? "yellow"
        : "green";

    return {
      total,
      aeoScore,
      geoSscore: geoScore,
      grade,
      checks,
      qaPairs,
      wordCount: countWords(text),
    };
  } catch {
    return null;
  }
}

/**
 * Hybrid entry point: heuristic by default; LLM-assisted only when optIn is
 * true AND a key is configured (falls back to heuristic otherwise). This is
 * the function callers should use so the free engine stays the default.
 */
export async function resolveAeoGeoScore(
  input: AeoGeoInput,
  opts?: { tenantId?: string; useLlm?: boolean }
): Promise<{ result: AeoGeoResult; source: "heuristic" | "llm" }> {
  const heuristic = scoreAeoGeo(input);
  if (!opts?.useLlm || !opts.tenantId) {
    return { result: heuristic, source: "heuristic" };
  }
  const llm = await scoreAeoGeoWithLLM(input, opts.tenantId);
  return llm ? { result: llm, source: "llm" } : { result: heuristic, source: "heuristic" };
}
