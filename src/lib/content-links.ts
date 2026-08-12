/**
 * Internal linking — resolve the model's [INTERNAL LINK: …] placeholders
 * against real pages from the workspace knowledge base.
 *
 * The blog prompt tells the model to mark suggested internal links as
 * `[INTERNAL LINK: anchor text → suggested page topic]`. Left alone, those
 * markers ship into saved posts as literal text — bad for readers and SEO.
 * This module replaces each marker with a real markdown link when the
 * knowledge base has a matching page (scraped URL items), and degrades to
 * plain anchor text (no dead/fake link) when nothing matches, so the author
 * can wire it manually.
 *
 * Pure functions — no I/O, safe for client and server import.
 */

export interface LinkablePage {
  /** Page title or KB item name — used for anchor matching. */
  title: string;
  /** Absolute URL of the page (from scraped KB URL items). */
  url: string;
  /** Optional scraped page text, used for topic matching. */
  text?: string;
}

/** Significant (non-stopword) tokens of a phrase, lower-cased. */
const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "for", "to", "of", "in", "on", "at",
  "by", "with", "from", "as", "is", "are", "was", "were", "be", "been", "our",
  "your", "their", "its", "it's", "this", "that", "these", "those", "how",
  "what", "why", "when", "where", "about", "into", "over", "under", "per",
  "vs", "versus", "via", "up", "out", "off", "do", "does", "did", "will",
  "would", "can", "could", "should", "may", "might", "must", "not", "no",
  "all", "any", "each", "more", "most", "some", "such", "than", "then",
  "there", "they", "we", "you", "us", "them", "he", "she", "it", "i", "me",
]);

export function significantWords(phrase: string): string[] {
  return phrase
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
}

/**
 * How well a page matches an anchor/topic phrase: weighted overlap of
 * significant words against the title (2x) plus the body text (1x).
 */
export function pageMatchScore(page: LinkablePage, phrase: string): number {
  const words = significantWords(phrase);
  if (words.length === 0) return 0;
  const titleWords = new Set(significantWords(page.title));
  const textWords = new Set(significantWords(page.text ?? ""));
  let score = 0;
  for (const w of words) {
    if (titleWords.has(w)) score += 2;
    else if (textWords.has(w)) score += 1;
  }
  return score;
}

/** Best matching page for a phrase, or null when nothing plausibly matches. */
export function findBestPage(
  pages: LinkablePage[],
  phrase: string
): LinkablePage | null {
  let best: LinkablePage | null = null;
  let bestScore = 0;
  for (const page of pages) {
    const score = pageMatchScore(page, phrase);
    // Require at least one title hit (score >= 2) or two body hits so we
    // never link to an unrelated page on a flimsy single-word overlap.
    if (score > bestScore && score >= 2) {
      best = page;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Replace [INTERNAL LINK: …] markers in a markdown body.
 *
 * Marker forms handled:
 *   [INTERNAL LINK: anchor text → suggested page topic]
 *   [INTERNAL LINK: anchor text -> suggested page topic]
 *   [INTERNAL LINK: anchor text]
 *   [INTERNAL LINK]  (no anchor — uses the matched page title)
 *
 * Matching page found → `[anchor](url)`. No match → the anchor text as plain
 * text (a clean, non-fabricated placeholder the author can link manually).
 */
export function resolveInternalLinks(
  body: string,
  pages: LinkablePage[]
): string {
  if (!body || pages.length === 0) return body;

  return body.replace(
    /\[INTERNAL\s+LINK:?\s*([^\]]*)\]/gi,
    (marker, rawInner: string) => {
      const inner = String(rawInner ?? "").trim();
      if (!inner) {
        // Bare [INTERNAL LINK] with no anchor — keep it as a clear TODO the
        // author can replace, rather than fabricating text.
        return marker;
      }
      // Split "anchor → topic" on arrow separators.
      const parts = inner
        .split(/\s*(?:→|->|=>|to|for)\s+/i)
        .map((s) => s.trim())
        .filter(Boolean);
      const anchor = parts[0];
      const topic = parts.slice(1).join(" ") || anchor;
      const page = findBestPage(pages, topic);
      if (!page) return anchor; // honest fallback: plain text, no fake link
      return `[${anchor}](${page.url})`;
    }
  );
}

/**
 * Build the prompt's SPECIFIC INTERNAL LINKS list (max `limit` pages) from
 * the knowledge base, with sensible anchor text derived from page titles.
 */
export function buildInternalLinkContext(
  pages: LinkablePage[],
  limit = 5
): { url: string; anchorText: string }[] {
  return pages.slice(0, limit).map((page) => ({
    url: page.url,
    anchorText: page.title.trim().replace(/\s+/g, " "),
  }));
}
