/**
 * WordPress SEO meta builder — deterministic, no extra model call.
 *
 * Turns an already-generated blog post (title, meta description, focus
 * keyword, extracted Q&A pairs, featured image) into the post-meta payload
 * a WordPress site needs: SEO title/description/focus-keyword overrides,
 * JSON-LD schema blocks (Article, FAQPage, HowTo, Recipe, Product, Service,
 * Organization, LocalBusiness, Event, Course, SoftwareApplication,
 * VideoObject, Person), and the OpenGraph/Twitter social blocks. The Q&A
 * pairs come from the same AEO/GEO heuristic engine the post is scored
 * with, so the schema and the score always agree.
 *
 * The combined `schema_jsonld` value is what publishers embed directly into
 * the post content — the only delivery guaranteed to land on any site.
 */

export type SchemaType =
  | "Article"
  | "FAQPage"
  | "HowTo"
  | "Recipe"
  | "Product"
  | "Service"
  | "Organization"
  | "LocalBusiness"
  | "Event"
  | "Course"
  | "SoftwareApplication"
  | "VideoObject"
  | "Person";

/** Schema selection: explicit list, or "auto" to detect from the content. */
export type SchemaSelection = SchemaType[] | "auto";

export interface SeoMetaInput {
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

export interface SeoMetaPayload {
  /**
   * Post-meta keys for a WordPress site (sent via the WP REST API and/or
   * embedded in content). Keys are generic — `schema_*` for JSON-LD blocks,
   * `og_*`/`twitter_*` for social, and one combined `schema_jsonld`.
   */
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

function siteNameOf(input: SeoMetaInput): string {
  return input.siteName?.trim() || "Agency OS";
}

/** Build the Article JSON-LD object. */
export function buildArticleSchema(input: SeoMetaInput): Record<string, unknown> {
  const now = input.datePublished ?? new Date().toISOString();
  const siteName = siteNameOf(input);
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
export function buildHowToSchema(input: SeoMetaInput): Record<string, unknown> | null {
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
export function buildRecipeSchema(input: SeoMetaInput): Record<string, unknown> | null {
  const steps = detectSteps(input.body);
  if (steps.length < 2) return null;
  return {
    "@type": ["Recipe"],
    name: input.title.slice(0, 110),
    description: (input.metaDescription || input.title).slice(0, 160),
    ...(input.featuredImageUrl ? { image: [input.featuredImageUrl] } : {}),
    author: { "@type": "Person", name: siteNameOf(input) },
    recipeInstructions: steps.map((s, i) => ({
      "@type": "HowToStep",
      position: i + 1,
      text: s.slice(0, 400),
    })),
  };
}

/** Build the Product JSON-LD (e-commerce / product pages). */
export function buildProductSchema(input: SeoMetaInput): Record<string, unknown> | null {
  return {
    "@type": ["Product"],
    name: input.title.slice(0, 110),
    description: (input.metaDescription || input.title).slice(0, 500),
    ...(input.featuredImageUrl ? { image: [input.featuredImageUrl] } : {}),
    ...(input.slug ? { url: cleanUrl(input.slug) } : {}),
  };
}

/** Build the Service JSON-LD (service businesses / offerings). */
export function buildServiceSchema(input: SeoMetaInput): Record<string, unknown> | null {
  return {
    "@type": ["Service"],
    name: input.title.slice(0, 110),
    description: (input.metaDescription || input.title).slice(0, 500),
    provider: { "@type": "Organization", name: siteNameOf(input) },
    ...(input.featuredImageUrl ? { image: [input.featuredImageUrl] } : {}),
  };
}

/** Build the Organization JSON-LD (the site's own org). */
export function buildOrganizationSchema(input: SeoMetaInput): Record<string, unknown> | null {
  return {
    "@type": ["Organization"],
    name: siteNameOf(input),
    ...(input.title ? { description: input.title.slice(0, 300) } : {}),
    ...(input.featuredImageUrl
      ? { logo: { "@type": "ImageObject", url: input.featuredImageUrl } }
      : {}),
    ...(input.slug ? { url: cleanUrl(input.slug) } : {}),
  };
}

/** Build the LocalBusiness JSON-LD (physical businesses with locations). */
export function buildLocalBusinessSchema(input: SeoMetaInput): Record<string, unknown> | null {
  return {
    "@type": ["LocalBusiness"],
    name: input.title.slice(0, 110),
    description: (input.metaDescription || input.title).slice(0, 300),
    ...(input.featuredImageUrl ? { image: [input.featuredImageUrl] } : {}),
  };
}

/** Build the Event JSON-LD (events, webinars, launches). */
export function buildEventSchema(input: SeoMetaInput): Record<string, unknown> | null {
  return {
    "@type": ["Event"],
    name: input.title.slice(0, 110),
    description: (input.metaDescription || input.title).slice(0, 500),
    ...(input.featuredImageUrl ? { image: [input.featuredImageUrl] } : {}),
    ...(input.datePublished ? { startDate: input.datePublished } : {}),
    organizer: { "@type": "Organization", name: siteNameOf(input) },
  };
}

/** Build the Course JSON-LD (courses, tutorials, training). */
export function buildCourseSchema(input: SeoMetaInput): Record<string, unknown> | null {
  return {
    "@type": ["Course"],
    name: input.title.slice(0, 110),
    description: (input.metaDescription || input.title).slice(0, 500),
    ...(input.featuredImageUrl ? { image: [input.featuredImageUrl] } : {}),
    provider: { "@type": "Organization", name: siteNameOf(input) },
  };
}

/** Build the SoftwareApplication JSON-LD (apps, SaaS, tools). */
export function buildSoftwareApplicationSchema(
  input: SeoMetaInput
): Record<string, unknown> | null {
  return {
    "@type": ["SoftwareApplication"],
    name: input.title.slice(0, 110),
    description: (input.metaDescription || input.title).slice(0, 500),
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    ...(input.featuredImageUrl ? { image: [input.featuredImageUrl] } : {}),
    ...(input.slug ? { url: cleanUrl(input.slug) } : {}),
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  };
}

/** Build the VideoObject JSON-LD (video content). */
export function buildVideoObjectSchema(input: SeoMetaInput): Record<string, unknown> | null {
  return {
    "@type": ["VideoObject"],
    name: input.title.slice(0, 110),
    description: (input.metaDescription || input.title).slice(0, 500),
    ...(input.featuredImageUrl ? { thumbnailUrl: [input.featuredImageUrl] } : {}),
    ...(input.datePublished ? { uploadDate: input.datePublished } : {}),
  };
}

/** Build the Person JSON-LD (author / profile pages). */
export function buildPersonSchema(input: SeoMetaInput): Record<string, unknown> | null {
  return {
    "@type": ["Person"],
    name: siteNameOf(input),
    ...(input.title ? { jobTitle: input.title.slice(0, 110) } : {}),
    ...(input.featuredImageUrl ? { image: [input.featuredImageUrl] } : {}),
  };
}

const SCHEMA_BUILDERS: Record<
  Exclude<SchemaType, "FAQPage" | "HowTo" | "Recipe">,
  (input: SeoMetaInput) => Record<string, unknown> | null
> = {
  Article: buildArticleSchema,
  Product: buildProductSchema,
  Service: buildServiceSchema,
  Organization: buildOrganizationSchema,
  LocalBusiness: buildLocalBusinessSchema,
  Event: buildEventSchema,
  Course: buildCourseSchema,
  SoftwareApplication: buildSoftwareApplicationSchema,
  VideoObject: buildVideoObjectSchema,
  Person: buildPersonSchema,
};

/** Resolve the schema selection: explicit list, or auto-detect from content. */
export function resolveSchemaTypes(
  selection: SchemaSelection | undefined,
  input: SeoMetaInput
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
 * Produce the full WordPress SEO meta payload for a generated post. Pure —
 * callable anywhere without a DB or model, so the manual generator, the AI
 * team pipeline, and tests all share one builder.
 */
export function buildWpSeoMeta(input: SeoMetaInput): SeoMetaPayload {
  const title = input.title?.trim() ?? "";
  const description = (input.metaDescription ?? "").trim();
  const focusKeyword = (input.focusKeyword ?? "").trim();
  const featuredImageUrl = input.featuredImageUrl ?? null;

  const schemaTypes = resolveSchemaTypes(input.schemaTypes, input);
  const steps = detectSteps(input.body);
  const faqCount =
    (input.qaPairs ?? []).filter((p) => (p.q ?? "").trim() && (p.a ?? "").trim()).length;

  const meta: Record<string, string | string[]> = {};
  if (title) meta.seo_title = title;
  if (description) meta.seo_description = description;
  if (focusKeyword) meta.focus_keyword = focusKeyword;

  // One JSON-LD block per selected schema type, plus a combined array that
  // publishers embed directly into the content (guaranteed delivery).
  const blocks: Record<string, unknown>[] = [];
  for (const type of schemaTypes) {
    let block: Record<string, unknown> | null = null;
    if (type === "FAQPage") block = buildFaqSchema(input.qaPairs);
    else if (type === "HowTo") block = buildHowToSchema(input);
    else if (type === "Recipe") block = buildRecipeSchema(input);
    else block = SCHEMA_BUILDERS[type]?.(input) ?? null;
    if (!block) continue;
    blocks.push(block);
    meta[`schema_${type}`] = JSON.stringify([block]);
  }
  if (blocks.length > 0) meta.schema_jsonld = JSON.stringify(blocks);

  // OpenGraph + Twitter social blocks.
  const social = !!featuredImageUrl || !!title;
  if (social) {
    meta.og_title = title.slice(0, 90) || focusKeyword;
    meta.og_description = description.slice(0, 200) || title.slice(0, 200);
    if (featuredImageUrl) meta.og_image = featuredImageUrl;
    meta.twitter_title = title.slice(0, 90) || focusKeyword;
    meta.twitter_description = description.slice(0, 200) || title.slice(0, 200);
    if (featuredImageUrl) meta.twitter_image = featuredImageUrl;
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
export function schemaPreview(input: SeoMetaInput): string {
  const blocks: Record<string, unknown>[] = [];
  const types = resolveSchemaTypes(input.schemaTypes, input);
  for (const type of types) {
    let block: Record<string, unknown> | null = null;
    if (type === "FAQPage") block = buildFaqSchema(input.qaPairs);
    else if (type === "HowTo") block = buildHowToSchema(input);
    else if (type === "Recipe") block = buildRecipeSchema(input);
    else block = SCHEMA_BUILDERS[type]?.(input) ?? null;
    if (block) blocks.push(block);
  }
  return JSON.stringify(blocks, null, 2);
}
