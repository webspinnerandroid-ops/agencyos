/**
 * Research-first content generation support.
 *
 * Before a blog post is written, this module finds the questions people are
 * actually asking about the keywords/topic and current trends worth
 * reflecting. Two paths:
 *
 *  1. "web" — real Google search grounding via the Gemini API (the platform
 *     GOOGLE_API_KEY already powers image generation, so no new credential
 *     is required). Gemini returns answers with live web content.
 *  2. "model" — fallback: the tenant's configured text model generates a
 *     question/trend set from its training knowledge. Labeled "model" so the
 *     UI is never misleading about whether real web research happened.
 *
 * The result is injected into the blog system prompt, and the saved post
 * carries the questions/trends/source so users can audit what research fed
 * the content.
 */

import { generateText } from "./orchestrator";
import type { AITask } from "./orchestrator";

export interface TopicResearch {
  questions: string[];
  trends: string[];
  source: "web" | "model";
}

interface ResearchInput {
  title?: string;
  topic?: string;
  keywords?: string[];
}

// gemini-flash-latest tracks the current stable flash model (2.5-flash was
// retired in 2026); override with GEMINI_RESEARCH_MODEL if needed.
const GEMINI_MODEL = process.env.GEMINI_RESEARCH_MODEL || "gemini-flash-latest";
const GEMINI_BASE =
  "https://generativelanguage.googleapis.com/v1beta";

function buildQuery(input: ResearchInput): string {
  const parts: string[] = [];
  if (input.topic) parts.push(`the topic "${input.topic}"`);
  if (input.keywords && input.keywords.length > 0) {
    parts.push(`the keywords: ${input.keywords.join(", ")}`);
  }
  if (input.title) parts.push(`the page title "${input.title}"`);
  if (parts.length === 0) return "the subject";
  return parts.join(" and ");
}

async function researchWithGemini(input: ResearchInput): Promise<TopicResearch | null> {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) return null;

  const query = buildQuery(input);
  const instruction =
    "You are a search-empowered content researcher who ALWAYS uses Google search before " +
    "answering. Find what people are ACTUALLY asking about this subject right now. Return " +
    "ONLY a JSON object (no prose, no code fences — but a ```json fence is tolerated) with " +
    'two arrays: "questions" (12-20 real questions people ask, phrased as a searcher would ' +
    'type them, ordered by how common they are) and "trends" (5-8 current trends, angles, or ' +
    "fresh developments worth reflecting in a blog post). Ground every item in the search " +
    "results and prefer sources from the last 12 months; do not invent.";

  const body = {
    systemInstruction: { parts: [{ text: instruction }] },
    contents: [{ role: "user", parts: [{ text: `Research ${query}. Use Google search right now.` }] }],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0.2 },
  };

  const res = await fetch(
    `${GEMINI_BASE}/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45000),
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.warn(`[research] Gemini research failed (${res.status}): ${text.slice(0, 300)}`);
    return null;
  }

  const data = await res.json();
  const text =
    data?.candidates?.[0]?.content?.parts
      ?.map((p: { text?: string }) => p.text ?? "")
      .join("") ?? "";
  if (!text) return null;

  const parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  const questions = Array.isArray(parsed.questions)
    ? parsed.questions.filter((q: unknown) => typeof q === "string").slice(0, 20)
    : [];
  const trends = Array.isArray(parsed.trends)
    ? parsed.trends.filter((t: unknown) => typeof t === "string").slice(0, 8)
    : [];
  if (questions.length === 0) return null;
  return { questions, trends, source: "web" };
}

async function researchWithModel(
  tenantId: string,
  input: ResearchInput
): Promise<TopicResearch> {
  const query = buildQuery(input);
  const prompt =
    `Act as a content researcher. Based on your knowledge of search behavior and current ` +
    `developments, produce the questions people commonly ask about ${query}, plus current trends. ` +
    `Return ONLY a JSON object: {"questions": ["...10-15 real questions..."], "trends": ["...5-8 trends..."]}.`;

  const raw = await generateText("team_chat" as AITask, prompt, tenantId, {
    systemPrompt:
      "You are a careful content researcher. Never invent: keep every question and trend plausible and useful for SEO content. Return only JSON.",
    temperature: 0.4,
    maxTokens: 3000,
  });

  const parsed = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  const questions = Array.isArray(parsed.questions)
    ? parsed.questions.filter((q: unknown) => typeof q === "string").slice(0, 20)
    : [];
  const trends = Array.isArray(parsed.trends)
    ? parsed.trends.filter((t: unknown) => typeof t === "string").slice(0, 8)
    : [];
  return {
    questions:
      questions.length > 0
        ? questions
        : [`What is the best way to learn about ${query}?`],
    trends,
    source: "model",
  };
}

export async function researchTopic(
  tenantId: string,
  input: ResearchInput
): Promise<TopicResearch> {
  // Real web research first.
  const web = await researchWithGemini(input);
  if (web) return web;

  // Fall back to the tenant's own text model (labeled "model").
  try {
    return await researchWithModel(tenantId, input);
  } catch (err) {
    console.warn("[research] Model fallback failed:", err);
    return { questions: [], trends: [], source: "model" };
  }
}
