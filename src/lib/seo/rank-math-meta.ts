/**
 * Rank Math meta builder — deterministic, no extra model call.
 *
 * Turns an already-generated blog post (title, meta description, focus
 * keyword, extracted Q&A pairs, featured image) into the post-meta payload
 * Rank Math reads on a WordPress site: SEO title/description/focus keyword
 * overrides, Article/FAQPage/HowTo/Recipe JSON-LD schema, and the
 * OpenGraph/Twitter social blocks. The Q&A pairs come from the same AEO/GEO
 * heuristic engine the post is scored with, so the schema and the score
 * always agree.
 */

export type SchemaType = "Article" | "FAQPage" | "HowTo" | "Recipe";

/** Schema selection: explicit list, or "auto" to detect from the content. */
export type SchemaSelection = SchemaType[] | "auto";

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
  /** Brand / publisher / author name — defaults to the client's company name. */
  siteName?: string | null;
  /** ISO date — defaults to now for fresh drafts. */
  datePublished?: string;
  /** Which schema types to emit; "auto" detects from the content. */
  schemaTypes?: SchemaSelection;
  /** Markdown body — used for auto-detection of HowTo / Recipe. */
  body?: string;
}

export interface RankMathPayload {
  /** Raw Rank Math post-meta keys (sent via the WP REST API). */
  meta: Record<string, string | string[]>;
  /** Readable summary for the UI (not sent to WP). */
  summary: {
    title: string;
    description: string;
    focusKeyword: string;
    schemaTypes: SchemaType[];
    faqCount: number;
    stepCount: number;
    social: boolean;
  };
}

function cleanUrl(slug?: string): string {
  const s = (slug ?? "").trim();
  return s ? `/${s.replace(/^\/+|\/+$/g, "")}` : "";
}

/** Detect how-to structure (numbered steps / "how to" language) in the body. */
export function detectSteps(body?: string): string[] {
  const text = (body ?? "") || "";
  // Numbered lists like "1. First ..." or markdown "1. First".
  const numbered = [...text.matchAll(/(?:^|\n)\s*\d+[.)]\s+([^\n]{3,})/g)]
    .map((m) => m[1].trim())
    .filter(Boolean)
    .slice(0, 12);
  if (numbered.length >= 2) return numbered;
  // Fall back to "Step 1:" style lines.
  const stepped = [...text.matchAll(/step\s+\d+[.:]\s*([^\n]{3,})/gi)]
    .map((m) => m[1].trim())
    .filter(Boolean)
    .slice(0, 12);
  return stepped;
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

/** Build the HowTo JSON-LD from detected numbered steps. */
export function buildHowToSchema(input: RankMathMetaInput): Record<string, unknown> | null {
  const steps = detectSteps(input.body);
  if (steps.length < 2) return null;
  return {
    "@type": ["HowTo"],
    name: input.title.slice(0, 110),
    description: (input.metaDescription || input.title).slice(0, 160),
    step: steps.map((s, i) => ({
      "@type": "HowToStep",
      position: i + 1,
      name: s.slice(0, 100),
      text: s.slice(0, 400),
    })),
  };
}

/** Build the Recipe JSON-LD (best-effort from title, description, steps). */
export function buildRecipeSchema(input: RankMathMetaInput): Record<string, unknown> | null {
  const steps = detectSteps(input.body);
  if (steps.length < 2) return null;
  return {
    "@type": ["Recipe"],
    name: input.title.slice(0, 110),
    description: (input.metaDescription || input.title).slice(0, 160),
    ...(input.featuredImageUrl ? { image: [input.featuredImageUrl] } : {}),
    author: { "@type": "Person", name: input.siteName?.trim() || "Agency OS" },
    recipeInstructions: steps.map((s, i) => ({
      "@type": "HowToStep",
      position: i + 1,
      text: s.slice(0, 400),
    })),
  };
}

/** Resolve the schema selection: explicit list, or auto-detect from content. */
export function resolveSchemaTypes(
  selection: SchemaSelection | undefined,
  input: RankMathMetaInput
): SchemaType[] {
  if (Array.isArray(selection) && selection.length > 0) {
    // Always keep Article unless the caller explicitly removed it — it is the
    // base schema for a blog post. FAQPage needs pairs to be useful.
    const types = [...selection] as SchemaType[];
    if (!types.includes("Article")) types.unshift("Article");
    return types;
  }
  // Auto: Article always; FAQPage when Q&A pairs exist; HowTo/Recipe when
  // enough numbered steps exist.
  const types: SchemaType[] = ["Article"];
  const faq = buildFaqSchema(input.qaPairs);
  if (faq) types.push("FAQPage");
  if (detectSteps(input.body).length >= 2) types.push("HowTo");
  return types;
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
  const siteName = input.siteName?.trim() || "Agency OS";
  const featuredImageUrl = input.featuredImageUrl ?? null;

  const schemaTypes = resolveSchemaTypes(input.schemaTypes, input);
  const steps = detectSteps(input.body);
  const faqCount =
    (input.qaPairs ?? []).filter((p) => (p.q ?? "").trim() && (p.a ?? "").trim()).length;

  const meta: Record<string, string | string[]> = {};
  if (title) meta.rank_math_title = title;
  if (description) meta.rank_math_description = description;
  if (focusKeyword) meta.rank_math_focus_keyword = focusKeyword;

  // JSON-LD array Rank Math stores per schema type.
  if (schemaTypes.includes("Article")) {
    meta.rank_math_schema_Article = JSON.stringify([buildArticleSchema(input)]);
  }
  if (schemaTypes.includes("FAQPage")) {
    const faq = buildFaqSchema(input.qaPairs);
    if (faq) meta.rank_math_schema_FAQPage = JSON.stringify([faq]);
  }
  if (schemaTypes.includes("HowTo")) {
    const howTo = buildHowToSchema(input);
    if (howTo) meta.rank_math_schema_HowTo = JSON.stringify([howTo]);
  }
  if (schemaTypes.includes("Recipe")) {
    const recipe = buildRecipeSchema(input);
    if (recipe) meta.rank_math_schema_Recipe = JSON.stringify([recipe]);
  }

  // OpenGraph + Twitter social blocks (Rank Math facebook/twitter keys).
  const social = !!featuredImageUrl || !!title;
  if (social) {
    meta.rank_math_facebook_title = title.slice(0, 90) || focusKeyword;
    meta.rank_math_facebook_description = description.slice(0, 200) || title.slice(0, 200);
    if (featuredImageUrl) meta.rank_math_facebook_image = featuredImageUrl;
    meta.rank_math_twitter_title = title.slice(0, 90) || focusKeyword;
    meta.rank_math_twitter_description = description.slice(0, 200) || title.slice(0, 200);
    if (featuredImageUrl) meta.rank_math_twitter_image = featuredImageUrl;
  }

  return {
    meta,
    summary: {
      title,
      description,
      focusKeyword,
      schemaTypes,
      faqCount: Math.min(faqCount, 10),
      stepCount: steps.length,
      social,
    },
  };
}

/** Human-readable JSON-LD preview for the UI (all emitted schema blocks). */
export function schemaPreview(input: RankMathMetaInput): string {
  const blocks: Record<string, unknown>[] = [];
  const types = resolveSchemaTypes(input.schemaTypes, input);
  if (types.includes("Article")) blocks.push(buildArticleSchema(input));
  const faq = buildFaqSchema(input.qaPairs);
  if (types.includes("FAQPage") && faq) blocks.push(faq);
  const howTo = buildHowToSchema(input);
  if (types.includes("HowTo") && howTo) blocks.push(howTo);
  const recipe = buildRecipeSchema(input);
  if (types.includes("Recipe") && recipe) blocks.push(recipe);
  return JSON.stringify(blocks, null, 2);
}
