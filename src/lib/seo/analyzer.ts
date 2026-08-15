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
import { scoreContent, type RankMathResult } from "@/lib/rankmath";
import { scoreAeoGeo, type AeoGeoResult } from "@/lib/aeo-geo";
import { brandKeyword, homepageMarkdown } from "@/lib/seo/audit-report";
import { fetchCompetitorHtml } from "@/lib/seo/competitor-fetch";

export interface AnalyzeRequest {
  /** URL to crawl and score. */
  url?: string;
  /** Raw text/markdown to score instead of a URL. */
  text?: string;
  /** Optional title override for text mode. */
  title?: string;
  /** Optional keyword to score against; derived from the URL otherwise. */
  keyword?: string;
}

export interface AnalyzeResult {
  mode: "url" | "text";
  url?: string;
  title: string;
  keyword: string;
  wordCount: number;
  fetched?: boolean;
  fetchError?: string;
  seo: RankMathResult | null;
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
    const html = await fetchCompetitorHtml(url);
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
      ...scored,
    };
  }

  // Text mode.
  const text = (req.text || "").trim();
  if (!text) {
    throw new Error("Provide a URL or pasted text to analyze.");
  }
  const title = (req.title || "").trim() || "Pasted content";
  const keyword = (req.keyword || "").trim() || brandKeyword("https://example.com");
  const scored = scoreAnalyzedContent({
    title,
    metaDescription: "",
    body: text,
    keyword,
    internalUrls: [],
  });
  return {
    mode,
    title,
    keyword,
    ...scored,
  };
}
