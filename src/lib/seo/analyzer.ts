/**
 * Content analyzer — run the same SEO + AEO/GEO engines used by audits on
 * any URL or pasted text, and return the full per-check results so the UI
 * can show exactly how the score was made.
 *
 * URL mode: fetch + parse the page (title, meta, headings, links, images)
 * like a competitor crawl, then score it.
 * Text mode: treat the pasted content as markdown/plain text body, with an
 * optional title + keyword.
 */

import * as cheerio from "cheerio";
import { scoreContent, type SeoScoreResult } from "@/lib/seo-scorer";
import { scoreAeoGeo, type AeoGeoResult } from "@/lib/aeo-geo";
import { brandKeyword, homepageMarkdown } from "@/lib/seo/audit-report";
import { fetchCompetitorHtmlDetailed } from "@/lib/seo/competitor-fetch";

export interface AnalyzeRequest {
  /** URL to crawl and score. */
  url?: string;
  /** Raw text/markdown to score instead of a URL. */
  text?: string;
  /** Optional title override for text mode. */
  title?: string;
  /** Optional keyword to score against; derived otherwise. */
  keyword?: string;
  /**
   * Text mode only: the URL this content lives at. Used to derive the same
   * focus keyword + slug the hosted URL audit would use, so pasted text and
   * the live page score consistently.
   */
  pageUrl?: string;
  /** Text mode only: the page's meta description, so the meta check matches the hosted audit. */
  metaDescription?: string;
}

export interface AnalyzeResult {
  mode: "url" | "text";
  url?: string;
  title: string;
  keyword: string;
  wordCount: number;
  fetched?: boolean;
  fetchError?: string;
  /** The exact markdown body that was scored — lets the user re-paste it for an identical score. */
  scoredBody?: string;
  seo: SeoScoreResult | null;
  aeoGeo: AeoGeoResult | null;
  scoreGate: {
    seo: number | null;
    aeo: number | null;
    geo: number | null;
    passesSeoGate: boolean;
    passesAeoGeoGate: boolean;
  };
}

function parseUrlOrNull(raw: string): string | null {
  const s = (raw || "").trim();
  if (!s) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    return u.href;
  } catch {
    return null;
  }
}

function slugOf(url: string): string {
  try {
    return new URL(url).pathname.replace(/\/$/, "") || "/home";
  } catch {
    return "/home";
  }
}

const STOPWORDS = new Set([
  "the", "and", "for", "with", "your", "you", "are", "was", "that", "this",
  "from", "have", "has", "not", "but", "our", "their", "they", "will",
  "can", "all", "when", "what", "why", "how", "about", "into", "than",
  "then", "these", "those", "its", "per", "each", "such", "more", "most",
  // Placeholder-ish words that commonly appear in auto-generated titles
  // ("Pasted content", "Rewritten content", …). These must NEVER become the
  // focus keyword — they are exactly how rewrites drifted off the original
  // subject in the past.
  "content", "pasted", "rewritten", "untitled", "title", "text", "article",
  "post", "blog", "page", "example", "topic", "just", "also", "out", "any",
  "get", "make", "use", "used", "using", "like", "here",
]);

/** Split text into significant (non-stopword, alphabetical) words. */
function significantWords(text: string): string[] {
  return (text ?? "")
    .split(/\s+/)
    .map((w) => w.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, ""))
    .filter(
      (w) =>
        w.length > 3 &&
        !STOPWORDS.has(w.toLowerCase()) &&
        /^[a-zA-Z]/.test(w)
    );
}

/**
 * Derive a sensible focus keyword for pasted text — never a placeholder like
 * "example" or "the topic". Prefers the title's significant words (title is
 * the strongest topic signal), then the most frequent body word, then the
 * body's leading significant words.
 */
export function deriveKeyword(title: string, text: string): string {
  const titleWords = significantWords(title);
  if (titleWords.length > 0) return titleWords.slice(0, 3).join(" ");

  const counts = new Map<string, number>();
  for (const raw of (text ?? "").toLowerCase().split(/\s+/)) {
    const w = raw.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
    if (w.length > 3 && !STOPWORDS.has(w) && /^[a-z]+$/.test(w)) {
      counts.set(w, (counts.get(w) ?? 0) + 1);
    }
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (top && top[1] >= 2) return top[0];

  const bodyWords = significantWords(text);
  if (bodyWords.length > 0) return bodyWords.slice(0, 3).join(" ");
  return "";
}

/** Parse fetched HTML into the shape the scoring engines need. */
export function parseHtmlForScoring(
  html: string,
  url: string
): {
  title: string;
  metaDescription: string;
  body: string;
  internalUrls: string[];
} {
  const $ = cheerio.load(html);
  const title = $("title").first().text().trim() || "";
  const metaDescription =
    $('meta[name="description"]').first().attr("content")?.trim() ?? "";
  const h1 = $("h1")
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean);
  const h2 = $("h2")
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean);
  const h3 = $("h3")
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean);
  $("script,style,noscript,svg,iframe,form,nav,footer,header").remove();
  const textPreview = $("body").text().replace(/\s+/g, " ").trim();
  const images = $("img")
    .map((_, el) => ({
      src: $(el).attr("src") ?? "",
      alt: $(el).attr("alt") ?? "",
      hasAlt: !!$(el).attr("alt"),
    }))
    .get()
    .filter((i) => i.src && !/^data:/i.test(i.src))
    .slice(0, 12);
  let host = "";
  try {
    host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    host = url.toLowerCase();
  }
  const internalLinks: { href: string; text: string }[] = [];
  const externalLinks: { href: string; text: string }[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    if (!/^https?:\/\//i.test(href)) return;
    const text = $(el).text().trim().slice(0, 80);
    let linkHost = "";
    try {
      linkHost = new URL(href).hostname.replace(/^www\./, "").toLowerCase();
    } catch {
      return;
    }
    if (linkHost === host) internalLinks.push({ href, text });
    else externalLinks.push({ href, text });
  });

  const body = homepageMarkdown({
    url,
    title,
    metaDescription,
    h1,
    h2,
    h3,
    textPreview,
    images,
    internalLinks: internalLinks.slice(0, 8),
    externalLinks: externalLinks.slice(0, 8),
  });

  return {
    title,
    metaDescription,
    body,
    internalUrls: internalLinks.map((l) => l.href),
  };
}

/** Score parsed content with both engines and summarize the 80/80 gate. */
export function scoreAnalyzedContent(input: {
  title: string;
  metaDescription: string;
  body: string;
  keyword: string;
  internalUrls: string[];
  url?: string;
}): Pick<AnalyzeResult, "seo" | "aeoGeo" | "scoreGate" | "wordCount"> {
  const seo =
    input.body.trim().length > 0 && input.title
      ? scoreContent({
          title: input.title,
          metaDescription: input.metaDescription,
          slug: input.url ? slugOf(input.url) : "/pasted-content",
          body: input.body,
          keyword: input.keyword,
          internalUrls: input.internalUrls,
        })
      : null;
  const aeoGeo =
    input.body.trim().length > 0 && input.title
      ? scoreAeoGeo({
          title: input.title,
          metaDescription: input.metaDescription,
          body: input.body,
          keyword: input.keyword,
          entities: [input.keyword, input.title],
        })
      : null;

  const seoTotal = seo?.total ?? null;
  const aeo = aeoGeo?.aeoScore ?? null;
  const geo = aeoGeo?.geoSscore ?? null;

  return {
    seo,
    aeoGeo,
    wordCount: seo?.wordCount ?? aeoGeo?.wordCount ?? 0,
    scoreGate: {
      seo: seoTotal,
      aeo,
      geo,
      passesSeoGate: seoTotal == null || seoTotal >= 80,
      passesAeoGeoGate:
        aeo == null || geo == null || (aeo >= 80 && geo >= 80),
    },
  };
}

/** Main entry — run the analysis for a URL or pasted text. */
export async function analyzeContent(
  req: AnalyzeRequest
): Promise<AnalyzeResult> {
  const url = req.url ? parseUrlOrNull(req.url) : null;
  const mode: "url" | "text" = url ? "url" : "text";

  if (mode === "url" && url) {
    const fetchOut = await fetchCompetitorHtmlDetailed(url);
    if (fetchOut.redirectedHome) {
      return {
        mode,
        url,
        title: "",
        keyword: brandKeyword(url),
        wordCount: 0,
        fetched: false,
        fetchError:
          `The URL redirected to the site homepage (${fetchOut.finalUrl ?? "/"}) instead of the page you asked for — common with subdirectory installs. Use the exact article URL, or paste the page's text with its page URL in text mode.`,
        seo: null,
        aeoGeo: null,
        scoreGate: {
          seo: null,
          aeo: null,
          geo: null,
          passesSeoGate: false,
          passesAeoGeoGate: false,
        },
      };
    }
    const html = fetchOut.html;
    if (!html) {
      return {
        mode,
        url,
        title: "",
        keyword: brandKeyword(url),
        wordCount: 0,
        fetched: false,
        fetchError:
          "Could not fetch the page (unreachable, bot-blocked, or JavaScript-rendered with no readable HTML).",
        seo: null,
        aeoGeo: null,
        scoreGate: {
          seo: null,
          aeo: null,
          geo: null,
          passesSeoGate: false,
          passesAeoGeoGate: false,
        },
      };
    }
    const parsed = parseHtmlForScoring(html, url);
    const keyword = (req.keyword || "").trim() || brandKeyword(url);
    const scored = scoreAnalyzedContent({
      ...parsed,
      keyword,
      url,
    });
    return {
      mode,
      url,
      title: parsed.title,
      keyword,
      fetched: true,
      scoredBody: parsed.body,
      ...scored,
    };
  }

  // Text mode.
  const text = (req.text || "").trim();
  if (!text) {
    throw new Error("Provide a URL or pasted text to analyze.");
  }
  const title = (req.title || "").trim() || "Pasted content";
  // When the pasted content lives at a known URL, score against the same
  // keyword/slug the hosted URL audit would use so the two never disagree.
  const pageUrl = req.pageUrl ? parseUrlOrNull(req.pageUrl) : null;
  const keyword =
    (req.keyword || "").trim() ||
    (pageUrl ? brandKeyword(pageUrl) : "") ||
    deriveKeyword(title, text);
  const scored = scoreAnalyzedContent({
    title,
    metaDescription: (req.metaDescription || "").trim(),
    body: text,
    keyword,
    internalUrls: [],
    url: pageUrl ?? undefined,
  });
  return {
    mode,
    title,
    keyword,
    scoredBody: text,
    ...scored,
  };
}
