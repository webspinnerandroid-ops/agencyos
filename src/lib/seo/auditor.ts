/**
 * SEO Website Auditor
 *
 * Uses cheerio to fetch a homepage, extract meta tags, headings, images,
 * and page text. Follows up to 5 internal links to build a basic site
 * structure map. Returns a comprehensive SiteAudit object.
 */

import * as cheerio from "cheerio";
import type { AuditData } from "@/lib/ai/seo-prompts";

// ============================================================================
// Types
// ============================================================================

export interface SiteAudit {
  url: string;
  scannedAt: string;
  homepage: PageAudit;
  internalPages: PageAudit[];
  siteStructure: SiteStructure;
  overallScore: number;
  technicalIssues: AuditIssue[];
  onPageIssues: AuditIssue[];
  contentGaps: string[];
  pageSpeedScore: number | null;
}

export interface PageAudit {
  url: string;
  title: string;
  metaDescription: string;
  metaKeywords: string;
  ogTitle: string;
  ogDescription: string;
  ogImage: string;
  twitterCard: string;
  canonical: string;
  robots: string;
  h1: string[];
  h2: string[];
  h3: string[];
  h4: string[];
  images: ImageAudit[];
  wordCount: number;
  textPreview: string;
  internalLinks: LinkAudit[];
  externalLinks: LinkAudit[];
  statusCode: number | null;
  loadTimeMs: number | null;
}

export interface ImageAudit {
  src: string;
  alt: string | null;
  hasAlt: boolean;
  width: string | null;
  height: string | null;
}

export interface LinkAudit {
  href: string;
  text: string;
  isInternal: boolean;
  nofollow: boolean;
}

export interface SiteStructure {
  pages: { url: string; title: string; depth: number }[];
  totalInternalLinks: number;
  maxDepth: number;
}

export interface AuditIssue {
  severity: "high" | "medium" | "low";
  description: string;
}

// ============================================================================
// Configuration
// ============================================================================

const MAX_INTERNAL_PAGES = 5;
const FETCH_TIMEOUT_MS = 15000;
const USER_AGENT =
  "Mozilla/5.0 (compatible; AgencyOS-SeoAuditor/1.0; +https://agency-os.dev)";

// ============================================================================
// Helpers
// ============================================================================

function isInternalLink(href: string, baseDomain: string): boolean {
  try {
    const url = new URL(href, `https://${baseDomain}`);
    const hostname = url.hostname.replace(/^www\./, "");
    const base = baseDomain.replace(/^www\./, "");
    return hostname === base || hostname.endsWith(`.${base}`);
  } catch {
    // Relative URLs are internal
    return (
      href.startsWith("/") ||
      href.startsWith("#") ||
      href.startsWith("./") ||
      href.startsWith("../") ||
      !href.includes("://")
    );
  }
}

function resolveUrl(href: string, baseUrl: string): string {
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return href;
  }
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // Remove trailing slash for consistency
    let normalized = parsed.origin + parsed.pathname.replace(/\/$/, "");
    if (parsed.search) normalized += parsed.search;
    return normalized;
  } catch {
    return url;
  }
}

async function fetchPage(
  url: string
): Promise<{ html: string; statusCode: number; loadTimeMs: number }> {
  const startTime = Date.now();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
      signal: controller.signal,
      redirect: "follow",
    });

    const loadTimeMs = Date.now() - startTime;
    const html = await response.text();
    const statusCode = response.status;

    return { html, statusCode, loadTimeMs };
  } finally {
    clearTimeout(timeout);
  }
}

// ============================================================================
// Page Audit
// ============================================================================

function auditPage(html: string, url: string, statusCode: number | null, loadTimeMs: number | null): PageAudit {
  const $ = cheerio.load(html);

  // Meta tags
  const title = $("title").first().text().trim();
  const metaDescription =
    $('meta[name="description"]').attr("content")?.trim() ?? "";
  const metaKeywords =
    $('meta[name="keywords"]').attr("content")?.trim() ?? "";
  const ogTitle = $('meta[property="og:title"]').attr("content")?.trim() ?? "";
  const ogDescription =
    $('meta[property="og:description"]').attr("content")?.trim() ?? "";
  const ogImage =
    $('meta[property="og:image"]').attr("content")?.trim() ?? "";
  const twitterCard =
    $('meta[name="twitter:card"]').attr("content")?.trim() ?? "";
  const canonical = $('link[rel="canonical"]').attr("href")?.trim() ?? "";
  const robots = $('meta[name="robots"]').attr("content")?.trim() ?? "";

  // Headings
  const h1: string[] = [];
  $("h1").each((_, el) => { h1.push($(el).text().trim()); });
  const h2: string[] = [];
  $("h2").each((_, el) => { h2.push($(el).text().trim()); });
  const h3: string[] = [];
  $("h3").each((_, el) => { h3.push($(el).text().trim()); });
  const h4: string[] = [];
  $("h4").each((_, el) => { h4.push($(el).text().trim()); });

  // Images
  const images: ImageAudit[] = [];
  $("img").each((_, el) => {
    const $el = $(el);
    const src = $el.attr("src") ?? $el.attr("data-src") ?? "";
    const alt = $el.attr("alt") ?? null;
    images.push({
      src,
      alt,
      hasAlt: !!alt && alt.trim().length > 0,
      width: $el.attr("width") ?? null,
      height: $el.attr("height") ?? null,
    });
  });

  // Body text
  const bodyText = $("body").text().replace(/\s+/g, " ").trim();
  const wordCount = bodyText.split(/\s+/).filter(Boolean).length;
  const textPreview = bodyText.substring(0, 500);

  // Links
  const baseDomain = extractDomain(url);
  const internalLinks: LinkAudit[] = [];
  const externalLinks: LinkAudit[] = [];

  $("a[href]").each((_, el) => {
    const $el = $(el);
    const href = $el.attr("href") ?? "";
    const text = $el.text().trim();
    const nofollow = ($el.attr("rel") ?? "").includes("nofollow");
    const internal = isInternalLink(href, baseDomain);

    const link: LinkAudit = {
      href: resolveUrl(href, url),
      text,
      isInternal: internal,
      nofollow,
    };

    if (internal) {
      internalLinks.push(link);
    } else {
      externalLinks.push(link);
    }
  });

  return {
    url,
    title,
    metaDescription,
    metaKeywords,
    ogTitle,
    ogDescription,
    ogImage,
    twitterCard,
    canonical,
    robots,
    h1,
    h2,
    h3,
    h4,
    images,
    wordCount,
    textPreview,
    internalLinks,
    externalLinks,
    statusCode,
    loadTimeMs,
  };
}

// ============================================================================
// Main: crawlWebsite
// ============================================================================

/**
 * Fetches a website homepage and follows up to 5 internal links to build
 * a basic site audit. Returns a full SiteAudit object with technical and
 * on-page issues identified.
 */
export async function crawlWebsite(url: string): Promise<SiteAudit> {
  // Ensure URL has protocol
  const normalizedUrl = url.startsWith("http") ? url : `https://${url}`;
  const baseDomain = extractDomain(normalizedUrl);

  // Fetch homepage
  let homepageHtml: string;
  let homepageStatusCode: number | null = null;
  let homepageLoadTime: number | null = null;

  try {
    const result = await fetchPage(normalizedUrl);
    homepageHtml = result.html;
    homepageStatusCode = result.statusCode;
    homepageLoadTime = result.loadTimeMs;
  } catch (error: any) {
    if (error.name === "AbortError") {
      throw new Error(`Request timed out for ${normalizedUrl}`);
    }
    throw new Error(
      `Failed to fetch ${normalizedUrl}: ${error?.message ?? "Unknown error"}`
    );
  }

  // Audit homepage
  const homepage = auditPage(homepageHtml, normalizedUrl, homepageStatusCode, homepageLoadTime);

  // Determine internal pages to follow
  const seenUrls = new Set<string>();
  seenUrls.add(normalizeUrl(normalizedUrl));

  const internalPages: PageAudit[] = [];
  const siteStructurePages: SiteStructure["pages"] = [
    { url: normalizedUrl, title: homepage.title, depth: 0 },
  ];

  let totalInternalLinks = homepage.internalLinks.length;
  let maxDepth = 0;

  // Pick up to MAX_INTERNAL_PAGES internal links to follow (depth 1)
  const linksToFollow = homepage.internalLinks
    .filter((link) => {
      const normalized = normalizeUrl(link.href);
      return (
        !seenUrls.has(normalized) &&
        !link.href.includes("mailto:") &&
        !link.href.includes("tel:") &&
        !link.href.endsWith(".pdf") &&
        !link.href.endsWith(".zip") &&
        !link.href.endsWith(".jpg") &&
        !link.href.endsWith(".png") &&
        !link.href.endsWith(".gif") &&
        !link.href.endsWith(".css") &&
        !link.href.endsWith(".js")
      );
    })
    .slice(0, MAX_INTERNAL_PAGES);

  // Fetch internal pages sequentially to be polite
  for (const link of linksToFollow) {
    const normalized = normalizeUrl(link.href);
    if (seenUrls.has(normalized)) continue;
    seenUrls.add(normalized);

    try {
      const result = await fetchPage(link.href);
      const pageAudit = auditPage(result.html, link.href, result.statusCode, result.loadTimeMs);
      internalPages.push(pageAudit);

      siteStructurePages.push({
        url: link.href,
        title: pageAudit.title,
        depth: 1,
      });

      totalInternalLinks += pageAudit.internalLinks.length;
      if (1 > maxDepth) maxDepth = 1;
    } catch {
      // Skip pages that fail to load
      continue;
    }
  }

  // Build site structure
  const siteStructure: SiteStructure = {
    pages: siteStructurePages,
    totalInternalLinks,
    maxDepth,
  };

  // Calculate overall score based on checks
  const { overallScore, technicalIssues, onPageIssues, contentGaps } =
    calculateScore(homepage, internalPages);

  return {
    url: normalizedUrl,
    scannedAt: new Date().toISOString(),
    homepage,
    internalPages: internalPages,
    siteStructure,
    overallScore,
    technicalIssues,
    onPageIssues,
    contentGaps,
    pageSpeedScore: homepageLoadTime
      ? estimatePageSpeedScore(homepageLoadTime)
      : null,
  };
}

// ============================================================================
// Score Calculation
// ============================================================================

function calculateScore(
  homepage: PageAudit,
  internalPages: PageAudit[]
): {
  overallScore: number;
  technicalIssues: AuditIssue[];
  onPageIssues: AuditIssue[];
  contentGaps: string[];
} {
  let score = 100;
  const technicalIssues: AuditIssue[] = [];
  const onPageIssues: AuditIssue[] = [];
  const contentGaps: string[] = [];

  // --- Title checks ---
  if (!homepage.title) {
    score -= 10;
    onPageIssues.push({
      severity: "high",
      description: "Missing page title. Every page needs a unique <title> tag.",
    });
  } else if (homepage.title.length < 30) {
    score -= 3;
    onPageIssues.push({
      severity: "medium",
      description: `Page title too short (${homepage.title.length} chars). Aim for 50-60 characters.`,
    });
  } else if (homepage.title.length > 70) {
    score -= 3;
    onPageIssues.push({
      severity: "medium",
      description: `Page title too long (${homepage.title.length} chars). Keep it under 60 characters to avoid truncation.`,
    });
  }

  // --- Meta description checks ---
  if (!homepage.metaDescription) {
    score -= 8;
    onPageIssues.push({
      severity: "high",
      description:
        "Missing meta description. Add a compelling 150-160 character meta description.",
    });
  } else if (homepage.metaDescription.length < 120) {
    score -= 3;
    onPageIssues.push({
      severity: "low",
      description: `Meta description is short (${homepage.metaDescription.length} chars). Aim for 150-160 characters.`,
    });
  } else if (homepage.metaDescription.length > 165) {
    score -= 3;
    onPageIssues.push({
      severity: "low",
      description: `Meta description too long (${homepage.metaDescription.length} chars). Keep it under 160 characters.`,
    });
  }

  // --- H1 checks ---
  if (homepage.h1.length === 0) {
    score -= 10;
    onPageIssues.push({
      severity: "high",
      description: "No H1 tag found. Every page should have exactly one H1.",
    });
  } else if (homepage.h1.length > 1) {
    score -= 5;
    onPageIssues.push({
      severity: "medium",
      description: `Multiple H1 tags found (${homepage.h1.length}). Use only one H1 per page.`,
    });
  }

  // --- Image alt text ---
  const imagesWithoutAlt = homepage.images.filter((img) => !img.hasAlt);
  if (homepage.images.length > 0) {
    const altRatio = imagesWithoutAlt.length / homepage.images.length;
    if (altRatio > 0.5) {
      score -= 8;
      technicalIssues.push({
        severity: "high",
        description: `${imagesWithoutAlt.length} of ${homepage.images.length} images missing alt text. Add descriptive alt attributes for accessibility and SEO.`,
      });
    } else if (altRatio > 0.2) {
      score -= 4;
      technicalIssues.push({
        severity: "medium",
        description: `${imagesWithoutAlt.length} of ${homepage.images.length} images missing alt text.`,
      });
    }
  }

  // --- Canonical ---
  if (!homepage.canonical) {
    score -= 3;
    technicalIssues.push({
      severity: "low",
      description:
        "No canonical URL specified. Add a canonical link to prevent duplicate content issues.",
    });
  }

  // --- OG tags ---
  if (!homepage.ogTitle && !homepage.ogDescription) {
    score -= 5;
    onPageIssues.push({
      severity: "medium",
      description:
        "Missing Open Graph tags. Add og:title and og:description for better social sharing previews.",
    });
  }

  // --- HTTPS ---
  if (!homepage.url.startsWith("https://")) {
    score -= 10;
    technicalIssues.push({
      severity: "high",
      description:
        "Site is not using HTTPS. Migrate to HTTPS for security and SEO ranking benefits.",
    });
  }

  // --- Word count check ---
  if (homepage.wordCount < 300) {
    score -= 5;
    contentGaps.push(
      `Homepage has low word count (${homepage.wordCount} words). Consider adding more substantive content for better indexing.`
    );
  }

  // --- Internal pages checks ---
  const pagesMissingTitles = internalPages.filter((p) => !p.title);
  if (pagesMissingTitles.length > 0) {
    score -= Math.min(pagesMissingTitles.length * 3, 10);
    technicalIssues.push({
      severity: "high",
      description: `${pagesMissingTitles.length} internal page(s) missing titles.`,
    });
  }

  // --- Status code ---
  if (homepage.statusCode && homepage.statusCode >= 400) {
    score -= 15;
    technicalIssues.push({
      severity: "high",
      description: `Homepage returned HTTP ${homepage.statusCode}. Ensure the page loads correctly.`,
    });
  }

  // --- Load time ---
  if (homepage.loadTimeMs && homepage.loadTimeMs > 5000) {
    score -= 8;
    technicalIssues.push({
      severity: "high",
      description: `Slow page load time (${(homepage.loadTimeMs / 1000).toFixed(1)}s). Optimize for better performance.`,
    });
  } else if (homepage.loadTimeMs && homepage.loadTimeMs > 2000) {
    score -= 3;
    technicalIssues.push({
      severity: "medium",
      description: `Page load time could be improved (${(homepage.loadTimeMs / 1000).toFixed(1)}s).`,
    });
  }

  // Clamp score
  const overallScore = Math.max(0, Math.min(100, score));

  return { overallScore, technicalIssues, onPageIssues, contentGaps };
}

/**
 * Rough page speed score estimation based on load time.
 */
function estimatePageSpeedScore(loadTimeMs: number): number {
  if (loadTimeMs <= 1000) return 90;
  if (loadTimeMs <= 2000) return 75;
  if (loadTimeMs <= 3000) return 60;
  if (loadTimeMs <= 5000) return 40;
  return 20;
}

// ============================================================================
// Conversion helpers
// ============================================================================

/**
 * Converts a SiteAudit into the AuditData format expected by
 * the SEO campaign prompt generator.
 */
export function toAuditData(audit: SiteAudit): AuditData {
  return {
    url: audit.url,
    overallScore: audit.overallScore,
    technicalIssues: audit.technicalIssues,
    onPageIssues: audit.onPageIssues,
    contentGaps: audit.contentGaps,
    keywordRankings: [], // Requires third-party API data
    backlinkProfile: undefined,
    pageSpeedScore: audit.pageSpeedScore ?? undefined,
  };
}