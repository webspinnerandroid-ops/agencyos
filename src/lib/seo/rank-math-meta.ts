/**
 * Rank Math meta builder — deterministic, no extra model call.
 *
 * Turns an already-generated blog post (title, meta description, focus
 * keyword, extracted Q&A pairs, featured image) into the post-meta payload
 * Rank Math reads on a WordPress site: SEO title/description/focus keyword
 * overrides plus Article and FAQPage JSON-LD schema. The Q&A pairs come from
 * the same AEO/GEO heuristic engine the post is scored with, so the schema
 * and the score always agree.
 */

export interface RankMathMetaInput {
  title: string;
  metaDescription: string;
  /** Primary focus keyword (the first target keyword). */
  focusKeyword: string;
  /** Question→answer pairs extracted from the body (FAQPage schema). */
  qaPairs?: { q: string; a: string }[];
  /** Absolute featured-image URL, if any (Article + social images). */
  featuredImageUrl?: string | null;
  /** Post slug (used for the canonical @id). */
  slug?: string;
  /** Brand / publisher name (falls back to a sensible default). */
  siteName?: string | null;
  /** ISO date — defaults to now for fresh drafts. */
  datePublished?: string;
}

export interface RankMathPayload {
  /** Raw Rank Math post-meta keys (sent via the WP REST API). */
  meta: Record<string, string | string[]>;
  /** Readable summary for the UI (not sent to WP). */
  summary: {
    title: string;
    description: string;
    focusKeyword: string;
    hasArticleSchema: boolean;
    hasFaqSchema: boolean;
    faqCount: number;
  };
}

function cleanUrl(slug?: string): string {
  const s = (slug ?? "").trim();
  return s ? `/${s.replace(/^\/+|\/+$/g, "")}` : "";
}

/** Build the Article JSON-LD object Rank Math stores under rank_math_schema_Article. */
export function buildArticleSchema(input: RankMathMetaInput): Record<string, unknown> {
  const now = input.datePublished ?? new Date().toISOString();
  const siteName = input.siteName?.trim() || "Agency OS";
  return {
    "@type": ["Article"],
    headline: input.title.slice(0, 110),
    description: (input.metaDescription || input.title).slice(0, 160),
    datePublished: now,
    dateModified: now,
    author: { "@type": "Person", name: siteName },
    publisher: { "@type": "Organization", name: siteName },
    ...(input.featuredImageUrl
      ? { image: [{ "@type": "ImageObject", url: input.featuredImageUrl, width: 1200, height: 630 }] }
      : {}),
    ...(input.slug
      ? { mainEntityOfPage: { "@type": "WebPage", "@id": cleanUrl(input.slug) } }
      : {}),
  };
}

/** Build the FAQPage JSON-LD object from the extracted Q&A pairs. */
export function buildFaqSchema(
  qaPairs?: { q: string; a: string }[]
): Record<string, unknown> | null {
  const pairs = (qaPairs ?? [])
    .map((p) => ({
      q: String(p.q ?? "").trim(),
      a: String(p.a ?? "").trim(),
    }))
    .filter((p) => p.q && p.a)
    .slice(0, 10);
  if (pairs.length === 0) return null;
  return {
    "@type": ["FAQPage"],
    mainEntity: pairs.map((p) => ({
      "@type": "Question",
      name: p.q.slice(0, 200),
      acceptedAnswer: { "@type": "Answer", text: p.a.slice(0, 500) },
    })),
  };
}

/**
 * Produce the full Rank Math meta payload for a generated post. Pure —
 * callable anywhere without a DB or model, so the manual generator, the AI
 * team pipeline, and tests all share one builder.
 */
export function buildRankMathMeta(input: RankMathMetaInput): RankMathPayload {
  const title = input.title?.trim() ?? "";
  const description = (input.metaDescription ?? "").trim();
  const focusKeyword = (input.focusKeyword ?? "").trim();

  const article = buildArticleSchema(input);
  const faq = buildFaqSchema(input.qaPairs);

  const meta: Record<string, string | string[]> = {};
  if (title) meta.rank_math_title = title;
  if (description) meta.rank_math_description = description;
  if (focusKeyword) meta.rank_math_focus_keyword = focusKeyword;
  // JSON-LD array Rank Math stores per schema type.
  meta.rank_math_schema_Article = JSON.stringify([article]);
  if (faq) meta.rank_math_schema_FAQPage = JSON.stringify([faq]);

  return {
    meta,
    summary: {
      title,
      description,
      focusKeyword,
      hasArticleSchema: true,
      hasFaqSchema: faq != null,
      faqCount: faq ? ((faq.mainEntity as unknown[]) ?? []).length : 0,
    },
  };
}

/** Human-readable JSON-LD preview for the UI (Article + FAQ blocks). */
export function schemaPreview(input: RankMathMetaInput): string {
  const blocks: Record<string, unknown>[] = [buildArticleSchema(input)];
  const faq = buildFaqSchema(input.qaPairs);
  if (faq) blocks.push(faq);
  return JSON.stringify(blocks, null, 2);
}
