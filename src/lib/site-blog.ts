// ============================================================================
// Site blog — WordPress-style blog for the marketing site (the super admin's
// own site at the root domain). Global, not tenant-scoped. Posts render
// publicly at /blog/<slug>; the super admin manages them in
// /dashboard/admin/blog.
// ============================================================================

export interface SiteBlogPost {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  body: string;
  featured_image_url: string | null;
  status: "draft" | "published";
  published_at: string | null;
  created_at: string;
  updated_at: string;
  /** Denormalized quality scores (migration 092) — stamped when generated
   * content is published to the site blog; null for manual posts. */
  seo_score?: number | null;
  aeo_geo_score?: number | null;
}

/** Tailwind classes for a score chip by value (matches post lists). */
export function siteScoreBadgeClass(score: number | null | undefined): string {
  if (typeof score !== "number") return "bg-gray-100 text-gray-600";
  if (score >= 80) return "bg-green-100 text-green-700";
  if (score >= 50) return "bg-yellow-100 text-yellow-700";
  return "bg-red-100 text-red-700";
}

/** Slugify a title the way the rest of the app does. */
export function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

/** Strip markdown down to plain text (for excerpts). */
function plainText(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links
    .replace(/[#>*_`~-]/g, " ") // formatting chars
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Derive an excerpt from a markdown body. Uses the first ~200 chars of plain
 * text, cutting at a word boundary. Falls back to the title.
 */
export function deriveExcerpt(body: string, title: string): string {
  const text = plainText(body || "");
  if (!text) return title.slice(0, 200);
  if (text.length <= 200) return text;
  const cut = text.slice(0, 200);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 100 ? cut.slice(0, lastSpace) : cut).trimEnd() + "…";
}

/** Pull the first inline image URL from a markdown body, if any. */
export function firstImageUrl(body: string): string | null {
  const m = body.match(/!\[[^\]]*\]\(([^)]+)\)/);
  if (!m) return null;
  const url = m[1].trim();
  return url.startsWith("data:") ? null : url;
}

/** Validate + normalize a slug for the public URL. */
export function sanitizePostSlug(slug: string): string | null {
  const s = slug.trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s)) return null;
  return s;
}
