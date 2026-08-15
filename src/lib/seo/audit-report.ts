/**
 * Public audit report helpers.
 *
 * `homepageMarkdown` rebuilds a markdown body from a stored homepage crawl
 * (PageAudit) so the existing SEO + AEO/GEO scoring engines can run on it.
 * `brandKeyword` derives the scoring keyword from the audited domain.
 */

export interface PageAuditShape {
  url?: string;
  title?: string;
  metaDescription?: string;
  h1?: string[];
  h2?: string[];
  h3?: string[];
  h4?: string[];
  textPreview?: string;
  wordCount?: number;
  images?: { src?: string; alt?: string | null; hasAlt?: boolean }[];
  internalLinks?: { href?: string; text?: string }[];
  externalLinks?: { href?: string; text?: string }[];
  loadTimeMs?: number | null;
}

/** Brand keyword for content scoring — the domain without the TLD. */
export function brandKeyword(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const parts = host.split(".");
    return parts.length >= 2 ? parts[parts.length - 2] : host;
  } catch {
    return url;
  }
}

/**
 * Rebuild a markdown body from the stored homepage crawl so the existing
 * SEO + AEO/GEO engines can score it. Order keeps real page text first
 * (so "keyword in first 10%" is honest), then appends the structured
 * extras (headings, links, images) which the engines parse as signals.
 */
export function homepageMarkdown(page: PageAuditShape | undefined): string {
  const parts: string[] = [];
  if (!page) return "";
  if (page.h1?.[0]) parts.push(`# ${page.h1[0]}`);
  else if (page.title) parts.push(`# ${page.title}`);
  if (page.title && page.h1?.[0] !== page.title) {
    parts.push(`This page is titled "${page.title}" and describes the business.`);
  }
  for (const para of (page.textPreview ?? "").split(/\n+/).map((p) => p.trim()).filter(Boolean)) {
    parts.push(para);
  }
  for (const h of page.h2 ?? []) parts.push(`## ${h}`);
  for (const h of page.h3 ?? []) parts.push(`### ${h}`);
  for (const h of page.h4 ?? []) parts.push(`#### ${h}`);
  const internal = (page.internalLinks ?? []).slice(0, 8);
  if (internal.length > 0) {
    parts.push(`## Related pages`);
    for (const l of internal) parts.push(`- [${l.text || l.href || "page"}](${l.href || "/"})`);
  }
  const external = (page.externalLinks ?? []).slice(0, 8);
  if (external.length > 0) {
    parts.push(`## Sources`);
    for (const l of external) parts.push(`- [${l.text || l.href || "source"}](${l.href || "#"})`);
  }
  const images = (page.images ?? []).filter((i) => i.src && !/^data:/i.test(i.src)).slice(0, 12);
  if (images.length > 0) {
    parts.push(`## Gallery`);
    for (const img of images) {
      parts.push(`![${img.alt || img.src || "image"}](${img.src})`);
    }
  }
  return parts.join("\n\n");
}

// ---------------------------------------------------------------------------
// Competitor scoring — benchmark the client against real competitor sites
// ---------------------------------------------------------------------------

import * as cheerio from "cheerio";
import { scoreContent, type RankMathResult } from "@/lib/rankmath";
import { scoreAeoGeo, type AeoGeoResult } from "@/lib/aeo-geo";

// ---------------------------------------------------------------------------
// Shared client content-score computation (dashboard + public report)
// ---------------------------------------------------------------------------

export interface AuditContentScores {
  seoContent: RankMathResult | null;
  aeoGeo: AeoGeoResult | null;
  brandKeyword: string;
  hasContentScores: boolean;
}

/**
 * Compute the SEO + AEO/GEO content scores for a stored audit from its
 * homepage crawl — the single source of truth used by both the dashboard
 * and the public audit report, so they can never disagree.
 */
export function computeContentScores(
  audit:
    | {
        url?: string;
        homepage?: PageAuditShape;
        internalPages?: PageAuditShape[];
      }
    | undefined,
  fallbackUrl?: string
): AuditContentScores {
  const homepage = audit?.homepage;
  const body = homepageMarkdown(homepage);
  const url = audit?.url ?? fallbackUrl ?? "";
  const keyword = brandKeyword(url);
  const internalUrls = (audit?.internalPages ?? [])
    .map((p) => p.url)
    .filter((u): u is string => Boolean(u))
    .concat(homepage?.url ? [homepage.url] : []);

  let seo: RankMathResult | null = null;
  let aeo: AeoGeoResult | null = null;
  if (body.trim().length > 0 && homepage?.title) {
    seo = scoreContent({
      title: homepage.title ?? "",
      metaDescription: homepage.metaDescription ?? "",
      slug: (() => {
        try {
          return (
            new URL(homepage.url ?? url).pathname.replace(/\/$/, "") || "/home"
          );
        } catch {
          return "/home";
        }
      })(),
      body,
      keyword,
      internalUrls,
    });
    aeo = scoreAeoGeo({
      title: homepage.title ?? "",
      metaDescription: homepage.metaDescription ?? "",
      body,
      keyword,
      entities: [keyword, homepage.title ?? ""],
    });
  }

  return {
    seoContent: seo,
    aeoGeo: aeo,
    brandKeyword: keyword,
    hasContentScores: seo !== null,
  };
}

export interface CompetitorScores {
  competitorUrl: string;
  title: string;
  seoScore: number | null;
  aeoScore: number | null;
  geoScore: number | null;
  wordCount: number | null;
  crawled: boolean;
}

/**
 * Score a competitor's homepage HTML with the same SEO + AEO/GEO engines
 * used for the client's audit, so proposals can benchmark client vs
 * competitors on equal terms. Pure and dependency-light: cheerio only.
 * Returns crawled:false when the HTML is unusable (no title/text).
 */
export function scoreCompetitorHtml(
  html: string,
  url: string
): CompetitorScores {
  const empty: CompetitorScores = {
    competitorUrl: url,
    title: "",
    seoScore: null,
    aeoScore: null,
    geoScore: null,
    wordCount: null,
    crawled: false,
  };
  try {
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

    if (!title && !textPreview) return empty;

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
    const keyword = brandKeyword(url);
    const internalUrls = internalLinks.map((l) => l.href);

    let seo: RankMathResult | null = null;
    let aeo: AeoGeoResult | null = null;
    if (body.trim().length > 0 && title) {
      seo = scoreContent({
        title,
        metaDescription,
        slug: (() => {
          try {
            return new URL(url).pathname.replace(/\/$/, "") || "/home";
          } catch {
            return "/home";
          }
        })(),
        body,
        keyword,
        internalUrls,
      });
      aeo = scoreAeoGeo({
        title,
        metaDescription,
        body,
        keyword,
        entities: [keyword, title],
      });
    }

    return {
      competitorUrl: url,
      title,
      seoScore: seo?.total ?? null,
      aeoScore: aeo?.aeoScore ?? null,
      geoScore: aeo?.geoSscore ?? null,
      wordCount: seo?.wordCount ?? null,
      crawled: true,
    };
  } catch {
    return empty;
  }
}
