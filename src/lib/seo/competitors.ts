/**
 * SEO Competitor Discovery
 *
 * Provides a competitor discovery mechanism. Currently uses a mock list
 * and manual input since paid APIs (Similarweb, Datareportal, SEMrush)
 * require API keys. When a paid API key is configured, the mock list
 * will be replaced by real API calls.
 *
 * Manually input competitors are stored in the `competitors` table so they
 * persist across sessions.
 */

import { createServiceClient } from "@/lib/supabase/server";
import type { CompetitorData } from "@/lib/ai/seo-prompts";

// ============================================================================
// Types
// ============================================================================

export interface CompetitorRecord {
  id: string;
  tenant_id: string;
  domain: string;
  name: string;
  url: string;
  is_manual: boolean;
  created_at: string;
}

// ============================================================================
// discoverCompetitors
// ============================================================================

/**
 * Returns a list of competitor domain URLs for a given domain.
 *
 * Resolution order:
 * 1. Query the `competitors` table for manual entries the user has saved.
 * 2. Use AI-powered competitor research based on the domain and website audit.
 * 3. Fall back to generic industry guesswork if AI is unavailable.
 */
export async function discoverCompetitors(
  domain: string,
  tenantId?: string,
  auditContext?: { url: string; homepageTitle?: string; metaDescription?: string; overallScore?: number }
): Promise<string[]> {
  const competitors: string[] = [];

  // 1. Try to get manual competitors from the database
  if (tenantId) {
    try {
      const supabase = await createServiceClient();
      const { data: manualCompetitors } = await supabase
        .from("competitors")
        .select("url")
        .eq("tenant_id", tenantId)
        .eq("is_manual", true)
        .order("created_at", { ascending: false })
        .limit(10);

      if (manualCompetitors && manualCompetitors.length > 0) {
        manualCompetitors.forEach((c) => {
          if (!competitors.includes(c.url)) {
            competitors.push(c.url);
          }
        });
        // If we have 3+ manual competitors, skip AI discovery
        if (competitors.length >= 3) return competitors.slice(0, 10);
      }
    } catch {
      console.warn("[Competitors] Could not fetch manual competitors from DB");
    }
  }

  // 2. AI-powered competitor discovery
  if (tenantId && auditContext) {
    try {
      const { generateStructuredOutput } = await import("@/lib/ai/orchestrator");

      const titleInfo = auditContext.homepageTitle ? `Website title: "${auditContext.homepageTitle}". ` : "";
      const descInfo = auditContext.metaDescription ? `Meta description: "${auditContext.metaDescription}". ` : "";

      const systemPrompt = `You are an SEO competitor research expert. Given a website domain and its audit data, identify the TOP 5 REAL competing businesses in that same industry/niche. These must be actual businesses that compete for the same customers, NOT SEO tools or marketing platforms. Return ONLY their website URLs.`;

      const userPrompt = `Domain: ${auditContext.url}
${titleInfo}${descInfo}Overall SEO score: ${auditContext.overallScore ?? "N/A"}/100.

Research and identify the top 5 businesses that directly compete with this website. These should be real companies in the same industry that would appear in Google search results, Google Business Profile local pack, or industry directories for the same keywords.

IMPORTANT: Do NOT include SEO tool companies (ahrefs, moz, semrush, etc.). Find actual competing businesses.`;

      const result = await generateStructuredOutput<{ competitors: string[] }>(
        "seo_audit" as any,
        systemPrompt,
        userPrompt,
        tenantId,
        {
          type: "object",
          properties: {
            competitors: {
              type: "array",
              items: { type: "string" },
              description: "Array of competitor website URLs (e.g. https://competitor.com)",
            },
          },
          required: ["competitors"],
        },
        { temperature: 0.3, maxTokens: 2048, functionName: "discover_competitors" }
      );

      if (result?.competitors && Array.isArray(result.competitors)) {
        for (const c of result.competitors) {
          if (competitors.length >= 10) break;
          // Validate it looks like a URL and isn't an SEO tool
          const normalized = c.startsWith("http") ? c : `https://${c}`;
          const isSeoTool = /ahrefs|moz\.com|semrush|spyfu|serpstat|majestic/i.test(normalized);
          if (!isSeoTool && !competitors.includes(normalized)) {
            competitors.push(normalized);
          }
        }
      }
    } catch (err) {
      console.warn("[Competitors] AI-powered discovery failed, using fallback:", (err as Error).message);
    }
  }

  return competitors.slice(0, 10);
}

// ============================================================================
// addManualCompetitor
// ============================================================================

/**
 * Stores a manually input competitor in the `competitors` table for the
 * given tenant. This allows agencies to build a competitor list over time
 * before integrating a paid API.
 */
export async function addManualCompetitor(
  tenantId: string,
  competitor: {
    domain: string;
    name?: string;
    url: string;
  }
): Promise<CompetitorRecord | null> {
  try {
    const supabase = await createServiceClient();

    const { data, error } = await supabase
      .from("competitors")
      .insert({
        tenant_id: tenantId,
        domain: competitor.domain,
        name: competitor.name ?? competitor.domain,
        url: competitor.url,
        is_manual: true,
      })
      .select("*")
      .single();

    if (error) {
      console.error("[Competitors] Failed to add manual competitor:", error);
      return null;
    }

    return data as CompetitorRecord;
  } catch (error) {
    console.error("[Competitors] Error adding manual competitor:", error);
    return null;
  }
}

// ============================================================================
// removeManualCompetitor
// ============================================================================

export async function removeManualCompetitor(
  tenantId: string,
  competitorId: string
): Promise<boolean> {
  try {
    const supabase = await createServiceClient();
    const { error } = await supabase
      .from("competitors")
      .delete()
      .eq("id", competitorId)
      .eq("tenant_id", tenantId)
      .eq("is_manual", true);

    if (error) {
      console.error("[Competitors] Failed to remove competitor:", error);
      return false;
    }

    return true;
  } catch (error) {
    console.error("[Competitors] Error removing competitor:", error);
    return false;
  }
}

// ============================================================================
// listManualCompetitors
// ============================================================================

export async function listManualCompetitors(
  tenantId: string
): Promise<CompetitorRecord[]> {
  try {
    const supabase = await createServiceClient();
    const { data } = await supabase
      .from("competitors")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("is_manual", true)
      .order("created_at", { ascending: false });

    return (data as CompetitorRecord[]) ?? [];
  } catch {
    return [];
  }
}

// ============================================================================
// fetchPage helper (lightweight version for competitor analysis)
// ============================================================================

const FETCH_TIMEOUT_MS = 10000;
const USER_AGENT =
  "Mozilla/5.0 (compatible; AgencyOS-SeoAuditor/1.0; +https://agency-os.dev)";

async function fetchCompetitorPage(
  url: string
): Promise<{ html: string; statusCode: number; loadTimeMs: number } | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: controller.signal,
      redirect: "follow",
    });

    const html = await response.text();
    return { html, statusCode: response.status, loadTimeMs: Date.now() };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ============================================================================
// Quick page analysis (no cheerio dependency needed — use regex)
// ============================================================================

function extractPageMeta(html: string, url: string): {
  title: string;
  description: string;
  wordCount: number;
  hasH1: boolean;
  hasSchema: boolean;
  hasGbpReference: boolean;
  keyPhrases: string[];
} {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch?.[1]?.trim() ?? "";

  const descMatch = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i);
  const description = descMatch?.[1]?.trim() ?? "";

  // Strip tags for word count
  const textOnly = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const wordCount = textOnly.split(/\s+/).filter(Boolean).length;

  const hasH1 = /<h1[^>]*>/i.test(html);
  const hasSchema = /application\/ld\+json|itemprop|itemscope|itemtype/i.test(html);

  // Check if the site references Google Business Profile (Maps pack indicator)
  const hasGbpReference =
    /google\.com\/maps|goo\.gl\/maps|maps\.google\.com|google.*business.*profile|google.*my.*business/i.test(html) ||
    /maps\.google/i.test(html);

  // Extract key phrases from headings (topical relevance)
  const headingMatches = html.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi) ?? [];
  const headings = headingMatches.map((h) => h.replace(/<[^>]+>/g, "").trim()).filter(Boolean);
  const keyPhrases = [...new Set(headings)].slice(0, 10);

  return { title, description, wordCount, hasH1, hasSchema, hasGbpReference, keyPhrases };
}

// ============================================================================
// Google Maps / GBP hint extraction from page content
// ============================================================================

function extractLocationHints(html: string): { hasAddress: boolean; hasPhone: boolean; cityMentions: string[] } {
  const hasAddress = /street|avenue|boulevard|drive|lane|road|highway|suite|floor/i.test(html);
  const hasPhone = /tel:|phone|call us|\+?\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/i.test(html);

  // Extract city mentions from common patterns
  const cityPatterns = [
    /(?:in|at|near|located in)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+){0,2})/g,
  ];
  const cityMentions: string[] = [];
  for (const pattern of cityPatterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      const city = match[1]?.trim();
      if (city && !cityMentions.includes(city) && cityMentions.length < 5) {
        cityMentions.push(city);
      }
    }
  }

  return { hasAddress, hasPhone, cityMentions };
}

// ============================================================================
// Conversion helper (with real crawling)
// ============================================================================

/**
 * Crawls each competitor URL and extracts real page data (meta, headings,
 * word count, schema, GBP references, location hints). Falls back to
 * AI-generated placeholder data if a competitor can't be reached.
 *
 * Converts a list of competitor URLs into the CompetitorData format
 * expected by the SEO campaign prompt generator.
 */
export async function toCompetitorData(
  urls: string[],
  auditContext?: { url: string; homepageTitle?: string; metaDescription?: string; overallScore?: number }
): Promise<CompetitorData[]> {
  const results: CompetitorData[] = [];

  for (const url of urls) {
    try {
      const page = await fetchCompetitorPage(url);
      if (page && page.html) {
        const meta = extractPageMeta(page.html, url);
        const location = extractLocationHints(page.html);

        // Build real strengths/weaknesses from crawled data
        const strengths: string[] = [];
        const weaknesses: string[] = [];

        if (meta.title.length >= 30 && meta.title.length <= 60) {
          strengths.push("Well-optimized page title length");
        } else if (meta.title.length > 0) {
          weaknesses.push(meta.title.length < 30
            ? "Page title is too short"
            : "Page title is too long (may get truncated)");
        } else {
          weaknesses.push("Missing page title tag");
        }

        if (meta.description.length >= 120 && meta.description.length <= 160) {
          strengths.push("Well-crafted meta description");
        } else if (meta.description.length > 0) {
          weaknesses.push("Meta description needs improvement");
        } else {
          weaknesses.push("Missing meta description");
        }

        if (meta.hasH1) {
          strengths.push("Uses H1 heading tag");
        } else {
          weaknesses.push("No H1 heading found");
        }

        if (meta.hasSchema) {
          strengths.push("Implements schema/structured data markup");
        } else {
          weaknesses.push("No structured data markup detected");
        }

        if (meta.wordCount > 500) {
          strengths.push(`Strong content depth (${meta.wordCount.toLocaleString()} words)`);
        } else if (meta.wordCount > 0) {
          weaknesses.push(`Thin content (only ${meta.wordCount} words on page)`);
        }

        if (page.loadTimeMs < 2000) {
          strengths.push("Fast page load time");
        } else if (page.loadTimeMs >= 5000) {
          weaknesses.push("Slow page load speed");
        }

        // GBP / local SEO hints
        if (meta.hasGbpReference) {
          strengths.push("Active Google Business Profile presence");
        }
        if (location.hasAddress && location.hasPhone) {
          strengths.push("Local business signals present (address + phone)");
        }

        // Industry context from key phrases
        const industryPhrases = meta.keyPhrases.length > 0
          ? meta.keyPhrases.slice(0, 5)
          : getDefaultIndustryKeywords(url, auditContext);

        let contentStrategy = "Content strategy unknown (page not analyzed)";
        if (meta.wordCount > 300) {
          contentStrategy = "Publishes substantive page content targeting relevant search queries";
        }
        if (meta.hasSchema) {
          contentStrategy += "; uses structured data for rich results";
        }
        if (meta.hasGbpReference || location.hasAddress) {
          contentStrategy += "; maintains local Google Business Profile presence";
        }

        results.push({
          competitorUrl: url,
          strengths: strengths.length > 0 ? strengths : ["Active web presence", "Established domain"],
          weaknesses: weaknesses.length > 0 ? weaknesses : ["Potential gaps in on-page optimization"],
          topKeywords: industryPhrases,
          contentStrategy,
        });
        continue;
      }
    } catch {
      // Fall through to AI placeholder below
    }

    // Fallback: honest placeholder — clearly labeled, never fabricated
    // as measured findings (see SEO Tool Review: "no structured data
    // detected on competitor sites" was previously presented as fact).
    results.push({
      competitorUrl: url,
      strengths: ["Site could not be fully crawled — review manually"],
      weaknesses: [
        "Competitor data below is AI-generated from the domain name only, NOT from a live crawl.",
      ],
      topKeywords: getDefaultIndustryKeywords(url, auditContext),
      contentStrategy:
        "Not crawled. Confirm this competitor manually before quoting their strategy to a client.",
    });
  }

  return results;
}

/**
 * Generates reasonable placeholder competitor data based on the competitor
 * domain name and the client's audit context. Used when the competitor
 * site cannot be crawled.
 */
function getDefaultCompetitorData(
  url: string,
  auditContext?: { url: string; homepageTitle?: string; metaDescription?: string; overallScore?: number }
): CompetitorData {
  const domain = url.replace(/^https?:\/\//, "").replace(/^www\./, "").split(".")[0] ?? "competitor";

  return {
    competitorUrl: url,
    strengths: [
      "Established web presence",
      "Appears in search results for target keywords",
      "Likely has domain authority in the niche",
    ],
    weaknesses: [
      "May have gaps in long-tail keyword coverage",
      "Content strategy may not be optimized for all search intents",
      "Potential for outperforming with better-converting content",
    ],
    topKeywords: getDefaultIndustryKeywords(url, auditContext),
    contentStrategy: `Likely uses a mix of homepage content and ${domain}-related keywords to attract organic traffic.`,
  };
}

/**
 * Derives likely industry keywords from the competitor domain and
 * the client's audit context (homepage title gives industry hints).
 */
function getDefaultIndustryKeywords(
  url: string,
  auditContext?: { url: string; homepageTitle?: string; metaDescription?: string; overallScore?: number }
): string[] {
  const domain = url.replace(/^https?:\/\//, "").replace(/^www\./, "");
  const parts = domain.replace(/\.com|\.org|\.net|\.co|\.io/gi, "").split(/[-.]/).filter((p) => p.length > 2);

  // Try to extract industry from the client's title
  const clientIndustry: string[] = [];
  if (auditContext?.homepageTitle) {
    const titleWords = auditContext.homepageTitle.toLowerCase().split(/\s+/);
    const knownIndustries = [
      "hotel", "restaurant", "dentist", "lawyer", "attorney", "plumber",
      "electrician", "roofer", "contractor", "realtor", "real estate",
      "insurance", "accountant", "clinic", "medical", "fitness", "gym",
      "salon", "spa", "auto", "repair", "cleaning", "landscaping",
      "photography", "agency", "consulting", "software", "saas",
    ];
    for (const word of titleWords) {
      if (knownIndustries.some((ind) => word.includes(ind))) {
        clientIndustry.push(word);
      }
    }
  }

  const industry = clientIndustry.length > 0
    ? clientIndustry.slice(0, 3)
    : parts.length > 0 ? parts.slice(0, 3) : ["service", "business", "solutions"];

  return industry.map((w) => `${w} ${w}`).concat([
    `best ${industry[0] ?? "service"}`,
    `${industry[0] ?? "service"} near me`,
    `affordable ${industry[0] ?? "service"}`,
  ]).slice(0, 6);
}
