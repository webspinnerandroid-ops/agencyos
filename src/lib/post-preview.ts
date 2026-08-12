// Shared helpers for rendering post rows and the post detail modal.
//
// The dashboard/list queries ship only lightweight denormalized columns
// (title, type, platform — see migration 021) at the top level, so those rows
// have no `content` key at all. The modal's full fetch (GET /api/posts/[id])
// keeps the nested shape. getPostPreview reads both.

export interface PostRow {
  id: string;
  content: any;
  status: string;
  ai_generated?: boolean;
  scheduled_at: string | null;
  tier_level?: number | null;
  created_at?: string | null;
  /** Denormalized Rank Math-style on-page SEO score (migration 025). */
  seo_score?: number | null;
  seo_checks?: unknown;
  /** Set when the post was published to the tenant's own CMS website. */
  cms_published_at?: string | null;
  cms_slug?: string | null;
}

interface FlatPost {
  title?: string;
  type?: string;
  platform?: string;
  caption?: string;
}

export interface PostPreview {
  title: string;
  type: string;
  platform: string;
  body: string;
  suggestedImagePrompt: string;
}

export function parseContent(content: unknown): Record<string, unknown> | null {
  if (typeof content === "string") {
    try {
      return JSON.parse(content) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return (content as Record<string, unknown> | null) ?? null;
}

/**
 * Resolves a post's SEO score from either the denormalized column or the
 * nested content.seo payload (whichever the row carries).
 */
export function getSeoScore(post: PostRow): number | null {
  if (typeof post.seo_score === "number") return post.seo_score;
  const c = parseContent(post.content) ?? {};
  const seo = c.seo as { score?: number } | undefined;
  return typeof seo?.score === "number" ? seo.score : null;
}

export function getPostPreview(post: PostRow): PostPreview {
  const c = parseContent(post.content) ?? {};
  const flat = post as unknown as FlatPost;
  const title =
    c.title ||
    flat.title ||
    (typeof c.caption === "string" ? c.caption.substring(0, 80) : "") ||
    flat.caption?.substring(0, 80) ||
    "Untitled";
  return {
    title: String(title),
    type: String(c.type || flat.type || "unknown"),
    platform: String(c.platform || flat.platform || ""),
    body: String(c.body || c.content || c.caption || flat.caption || ""),
    suggestedImagePrompt: String(c.suggestedImagePrompt || ""),
  };
}

export const statusColors: Record<string, string> = {
  draft: "bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300",
  published: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
  scheduled: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  failed: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  pending_approval: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
  approved: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
};

export function statusBadgeClass(status: string): string {
  return statusColors[status] || "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300";
}

export function formatShortDate(iso?: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
