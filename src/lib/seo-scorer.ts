/**
 * On-page content scorer.
 *
 * A native, dependency-free 100-point on-page scoring model built on the
 * widely documented on-page breakdown (Basic SEO ~50, Links ~25, Image &
 * Readability ~25). Scores are surfaced as an approximation everywhere they
 * appear in the UI.
 *
 * Every test is a pure function: it either passes (full points), fails (0),
 * or — for content length — earns a fractional multiplier. The aggregator
 * sums points to a 0-100 score with a per-test checklist so the UI can show
 * exactly what passed and what to fix.
 */

export interface SeoScoreCheck {
  id: string;
  label: string;
  category: "Basic SEO" | "Links" | "Images & Readability";
  maxPoints: number;
  earned: number;
  passed: boolean;
  detail: string;
}

export interface SeoScoreResult {
  total: number;
  grade: "red" | "yellow" | "green";
  checks: SeoScoreCheck[];
  /** The exact keyword that was scored against. */
  keyword: string;
  wordCount: number;
}

export interface SeoScoreInput {
  title: string;
  metaDescription: string;
  slug: string;
  /** Markdown body. Image syntax is stripped before text analysis. */
  body: string;
  keyword: string;
  /** URLs of the site's own pages (knowledge base) — used to distinguish internal vs outbound links. */
  internalUrls: string[];
}

// ---------------------------------------------------------------------------
// Small parsing helpers (pure, no DOM required — the body is markdown)
// ---------------------------------------------------------------------------

export function stripMarkdownImage(text: string): string {
  return text.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
}

export function plainText(body: string): string {
  const withoutImages = stripMarkdownImage(body);
  return withoutImages
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_>~|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

interface ParsedLink {
  text: string;
  url: string;
}

export function extractLinks(body: string): ParsedLink[] {
  const links: ParsedLink[] = [];
  // Negative lookbehind: skip image syntax (![alt](url)) — the same brackets
  // would otherwise match as a link with the alt text as its label.
  const re = /(?<!!)\[([^\]]*)\]\(([^)\s]+)\)/g;
  for (const m of body.matchAll(re)) {
    const url = m[2];
    if (/^IMAGE_URL/i.test(url)) continue;
    if (/^data:/i.test(url)) continue;
    links.push({ text: m[1]?.trim() ?? "", url });
  }
  return links;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

export interface ParsedImage {
  alt: string;
  url: string;
}

export function extractImages(body: string): ParsedImage[] {
  const images: ParsedImage[] = [];
  const re = /!\[([^\]]*)\]\(([^)\s]+)\)/g;
  for (const m of body.matchAll(re)) {
    const url = m[2];
    if (/^IMAGE_URL/i.test(url)) continue;
    images.push({ alt: m[1]?.trim() ?? "", url });
  }
  return images;
}

export function splitParagraphs(body: string): string[] {
  // Split on blank lines FIRST — plainText collapses whitespace, which would
  // otherwise merge every paragraph into one block.
  return stripMarkdownImage(body)
    .split(/\n\s*\n/)
    .map((p) => plainText(p))
    .map((p) => p.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Content-length multiplier (documented word-count thresholds)
// ---------------------------------------------------------------------------

export function contentLengthMultiplier(wordCount: number): number {
  if (wordCount < 600) return 0;
  if (wordCount < 1000) return 0.2;
  if (wordCount < 1500) return 0.4;
  if (wordCount < 2000) return 0.6;
  if (wordCount <= 2500) return 0.7;
  return 1;
}

// ---------------------------------------------------------------------------
// The test battery
// ---------------------------------------------------------------------------

function includesKeyword(haystack: string, keyword: string): boolean {
  return haystack.toLowerCase().includes(keyword.toLowerCase());
}

export function keywordDensityRatio(bodyText: string, keyword: string): number {
  const words = countWords(bodyText);
  if (words === 0) return 0;
  const kwWords = countWords(keyword);
  if (kwWords === 0) return 0;
  const re = new RegExp(escapeRegExp(keyword.toLowerCase()), "g");
  const occurrences = (bodyText.toLowerCase().match(re) ?? []).length;
  // Density = (keyword occurrences * keyword word count) / total words * 100
  return (occurrences * kwWords * 100) / words;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// scoreContent — the aggregator
// ---------------------------------------------------------------------------

export function scoreContent(input: SeoScoreInput): SeoScoreResult {
  const keyword = input.keyword.trim().toLowerCase();
  const text = plainText(input.body);
  const wordCount = countWords(text);
  const paragraphs = splitParagraphs(input.body);
  const links = extractLinks(input.body);
  const images = extractImages(input.body);

  const internalHosts = new Set(
    input.internalUrls.map((u) => hostOf(u)).filter(Boolean)
  );
  const internalLinks = links.filter((l) => internalHosts.has(hostOf(l.url)));
  const outboundLinks = links.filter(
    (l) => !internalHosts.has(hostOf(l.url))
  );

  const density = keywordDensityRatio(text, keyword);
  const densityOk = density >= 0.5 && density <= 3.0;

  const titlePass = includesKeyword(input.title, keyword);
  const metaPass = includesKeyword(input.metaDescription, keyword);
  // Slugs use hyphens/underscores where the keyword has spaces.
  const slugPass = includesKeyword(input.slug.replace(/[-_]/g, " "), keyword);

  const checkLength = Math.max(300, Math.floor(text.length * 0.1));
  const first10Pass = text
    .substring(0, checkLength)
    .toLowerCase()
    .includes(keyword);

  const bodyPass = text.toLowerCase().includes(keyword);
  const lengthMultiplier = contentLengthMultiplier(wordCount);

  const allAltsPresent =
    images.length > 0 && images.every((img) => img.alt.trim().length > 0);
  const anyAltHasKeyword = images.some((img) =>
    includesKeyword(img.alt, keyword)
  );
  const imageAltPass = allAltsPresent && anyAltHasKeyword;

  const longParagraph = paragraphs.some((p) => countWords(p) > 120);
  const subheadings = (input.body.match(/^#{2,3}\s+.+$/gm) ?? []).length;

  // ---- Graduated (partial-credit) signals -------------------------------
  // Each check below earns a multiplier 0..1 of its maxPoints, so a
  // near-miss scores partial points instead of all-or-nothing. A full pass
  // always earns 1.0 (maxPoints) and never changes, so a perfectly optimized
  // piece still totals exactly 100.
  const keywordWords = keyword.split(/\s+/).filter(Boolean);
  const anyKeywordWord = (s: string) =>
    keywordWords.some((w) => w.length > 0 && includesKeyword(s, w));

  // Title / meta / slug: exact keyword = full; at least one keyword word
  // present = half credit; nothing = 0.
  const titleMultiplier = titlePass ? 1 : anyKeywordWord(input.title) ? 0.5 : 0;
  const metaMultiplier = metaPass ? 1 : anyKeywordWord(input.metaDescription) ? 0.5 : 0;
  const slugMultiplier = slugPass ? 1 : anyKeywordWord(input.slug.replace(/[-_]/g, " ")) ? 0.5 : 0;

  // First 10%: full; within the first quarter of the body = half credit.
  const quarterLength = Math.max(300, Math.floor(text.length * 0.25));
  const first10Multiplier = first10Pass
    ? 1
    : text.substring(0, quarterLength).toLowerCase().includes(keyword)
      ? 0.5
      : 0;

  // Body presence: 0 mentions = 0, 1 mention = 60%, 2+ = full.
  const bodyOccurrences = (text.toLowerCase().match(new RegExp(escapeRegExp(keyword), "g")) ?? []).length;
  const bodyMultiplier = bodyPass ? (bodyOccurrences >= 2 ? 1 : 0.6) : 0;

  // Density: healthy range = full; mild under/over = half; extreme = 0.
  const densityMultiplier = densityOk
    ? 1
    : (density >= 0.25 && density < 0.5) || (density > 3.0 && density <= 4.5)
      ? 0.5
      : 0;

  // Internal/outbound links stay binary (any link present = full) — a single
  // reference is a legitimate full pass, matching the documented tests.
  const internalMultiplier = internalLinks.length > 0 ? 1 : 0;
  const outboundMultiplier = outboundLinks.length > 0 ? 1 : 0;

  // Images: keyword alt on every image = full; keyword alt on some = 70%;
  // alts all present but none with keyword = 40%; otherwise partial.
  const imagesMultiplier =
    images.length === 0
      ? 0
      : allAltsPresent && anyAltHasKeyword
        ? 1
        : anyAltHasKeyword
          ? 0.7
          : allAltsPresent
            ? 0.4
            : 0.2;

  // Paragraphs: fraction of paragraphs within the 120-word limit.
  const paragraphsMultiplier =
    paragraphs.length === 0
      ? 0
      : paragraphs.filter((p) => countWords(p) <= 120).length / paragraphs.length;

  // Subheadings: 0 = 0, 1 = half, 2+ = full.
  const subheadingsMultiplier = subheadings >= 2 ? 1 : subheadings === 1 ? 0.5 : 0;

  const defs: {
    id: string;
    label: string;
    category: SeoScoreCheck["category"];
    maxPoints: number;
    passed: boolean;
    multiplier?: number;
    detail: string;
  }[] = [
    {
      id: "title",
      label: "Focus keyword in SEO title",
      category: "Basic SEO",
      maxPoints: 6,
      passed: titlePass,
      multiplier: titleMultiplier,
      detail: titlePass
        ? `Title contains "${keyword}"`
        : titleMultiplier > 0
          ? `Title contains part of the keyword (${keywordWords.join(" / ")})`
          : `Title does not contain "${keyword}"`,
    },
    {
      id: "meta",
      label: "Focus keyword in meta description",
      category: "Basic SEO",
      maxPoints: 6,
      passed: metaPass,
      multiplier: metaMultiplier,
      detail: metaPass
        ? `Meta description contains "${keyword}"`
        : metaMultiplier > 0
          ? `Meta description contains part of the keyword`
          : `Meta description does not contain "${keyword}"`,
    },
    {
      id: "slug",
      label: "Focus keyword in URL slug",
      category: "Basic SEO",
      maxPoints: 6,
      passed: slugPass,
      multiplier: slugMultiplier,
      detail: slugPass
        ? `Slug contains "${keyword}"`
        : slugMultiplier > 0
          ? "Slug contains part of the keyword"
          : `Slug does not contain "${keyword}"`,
    },
    {
      id: "first10",
      label: "Focus keyword in first 10% of content",
      category: "Basic SEO",
      maxPoints: 6,
      passed: first10Pass,
      multiplier: first10Multiplier,
      detail: first10Pass
        ? "Keyword appears near the top of the body"
        : first10Multiplier > 0
          ? "Keyword appears in the first quarter of the body"
          : "Keyword does not appear in the first 10% of the body",
    },
    {
      id: "body",
      label: "Focus keyword in content body",
      category: "Basic SEO",
      maxPoints: 6,
      passed: bodyPass,
      multiplier: bodyMultiplier,
      detail: bodyPass
        ? `Keyword "${keyword}" appears ${bodyOccurrences} time(s) in the body`
        : `Keyword "${keyword}" never appears in the body`,
    },
    {
      id: "density",
      label: "Keyword density (not overstuffed)",
      category: "Basic SEO",
      maxPoints: 6,
      passed: densityOk,
      multiplier: densityMultiplier,
      detail: `${density.toFixed(2)}% density — ${
        densityOk
          ? "within the healthy 0.5–3.0% range"
          : density < 0.5
            ? "below the 0.5% minimum"
            : "above the 3.0% maximum (overstuffed)"
      }`,
    },
    {
      id: "length",
      label: "Content length",
      category: "Basic SEO",
      maxPoints: 14,
      passed: lengthMultiplier > 0,
      multiplier: lengthMultiplier,
      detail: `${wordCount.toLocaleString()} words — ${
        lengthMultiplier >= 1
          ? "meets the 2500+ word target"
          : Math.round(lengthMultiplier * 100) + "% of the length points earned"
      }`,
    },
    {
      id: "internal",
      label: "Internal links present",
      category: "Links",
      maxPoints: 8,
      passed: internalLinks.length > 0,
      multiplier: internalMultiplier,
      detail:
        internalLinks.length > 0
          ? `${internalLinks.length} internal link(s) to known site pages`
          : "No internal links to known site pages (add links to other pages of the site)",
    },
    {
      id: "outbound",
      label: "Outbound link present",
      category: "Links",
      maxPoints: 8,
      passed: outboundLinks.length > 0,
      multiplier: outboundMultiplier,
      detail:
        outboundLinks.length > 0
          ? `${outboundLinks.length} outbound link(s) present`
          : "No outbound links — add at least one external reference",
    },
    {
      id: "images",
      label: "Image alt text contains focus keyword",
      category: "Images & Readability",
      maxPoints: 9,
      passed: imageAltPass,
      multiplier: imagesMultiplier,
      detail: images.length === 0
        ? "No images in the post — add at least one with a keyword-bearing alt"
        : !allAltsPresent
          ? "One or more images are missing alt text"
          : !anyAltHasKeyword
            ? `None of the ${images.length} image alt(s) contain "${keyword}"`
            : `${images.length} image(s) present and alts contain "${keyword}"`,
    },
    {
      id: "paragraphs",
      label: "No paragraphs over 120 words",
      category: "Images & Readability",
      maxPoints: 13,
      passed: !longParagraph,
      multiplier: paragraphsMultiplier,
      detail: longParagraph
        ? "At least one paragraph exceeds 120 words — break it up"
        : "All paragraphs are within the 120-word readability limit",
    },
    {
      id: "subheadings",
      label: "Subheadings used (H2/H3)",
      category: "Images & Readability",
      maxPoints: 12,
      passed: subheadings >= 2,
      multiplier: subheadingsMultiplier,
      detail:
        subheadings >= 2
          ? `${subheadings} H2/H3 subheadings structure the post`
          : "Fewer than 2 H2/H3 subheadings — add more structure",
    },
  ];

  const checks: SeoScoreCheck[] = defs.map((d) => ({
    id: d.id,
    label: d.label,
    category: d.category,
    maxPoints: d.maxPoints,
    earned: Math.round((d.multiplier ?? 1) * d.maxPoints),
    passed: (d.multiplier ?? 1) >= 1,
    detail: d.detail,
  }));

  const total = Math.min(
    100,
    checks.reduce((acc, c) => acc + c.earned, 0)
  );

  return {
    total,
    grade: total < 50 ? "red" : total <= 80 ? "yellow" : "green",
    checks,
    keyword,
    wordCount,
  };
}

// ---------------------------------------------------------------------------
// Score badge helper (shared by the dashboard + list UIs)
// ---------------------------------------------------------------------------

export function scoreBadgeClass(total: number): string {
  if (total < 50) {
    return "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300";
  }
  if (total <= 80) {
    return "bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300";
  }
  return "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300";
}
