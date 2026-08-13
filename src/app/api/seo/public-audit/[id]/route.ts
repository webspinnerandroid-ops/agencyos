import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { scoreContent, type RankMathResult } from "@/lib/rankmath";
import { scoreAeoGeo, type AeoGeoResult } from "@/lib/aeo-geo";
import { brandKeyword, homepageMarkdown, type PageAuditShape } from "@/lib/seo/audit-report";

/**
 * GET /api/seo/public-audit/[id]
 *
 * Public, unauthenticated report for a single site audit — the client-facing
 * counterpart of the shareable proposal page. The id is an unguessable UUID
 * (same trust model as ?clientId= proposal links), and the route returns only
 * the audit data for that one row — never a list, never other tenants' data.
 *
 * The SEO / AEO / GEO content scores are computed here, server-side, from the
 * stored homepage crawl (title, meta, headings, text, links, images) so the
 * client page renders instantly and the engines stay the single source of
 * truth.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface CampaignRow {
  id: string;
  url: string;
  tier_name: string | null;
  tier_price: number | null;
  status: string | null;
  audit_json: unknown;
  competitors_json: unknown;
  location: string | null;
  created_at: string | null;
  share_enabled?: boolean | null;
  share_token?: string | null;
}

interface AuditShape {
  url?: string;
  scannedAt?: string;
  overallScore?: number;
  technicalIssues?: { severity: string; description: string }[];
  onPageIssues?: { severity: string; description: string }[];
  contentGaps?: string[];
  pageSpeedScore?: number | null;
  homepage?: PageAuditShape;
  internalPages?: PageAuditShape[];
  location?: string;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    // The public link is either the campaign UUID (legacy / default) or a
    // regenerated share token. Share tokens are 32-char hex, not UUIDs.
    const isUuid = UUID_RE.test(id);
    if (!isUuid && !/^[a-f0-9]{32}$/i.test(id)) {
      return NextResponse.json(
        { error: "Invalid audit link." },
        { status: 400 }
      );
    }

    const supabase = await createServiceClient();
    // share_enabled / share_token exist after migration 056. Query with them,
    // and fall back to the pre-056 shape if the columns aren't applied yet so
    // the public report never breaks while a migration is pending.
    let data: CampaignRow | null = null;
    const cols =
      "id, url, tier_name, tier_price, status, audit_json, competitors_json, location, created_at, share_enabled, share_token";
    let query = supabase
      .from("seo_campaigns")
      .select(cols);
    if (isUuid) {
      query = query.eq("id", id);
    } else {
      query = query.eq("share_token", id);
    }
    const { data: full, error: err } = await query.maybeSingle();
    if (!err && full) {
      data = full as unknown as CampaignRow;
    } else if (isUuid) {
      // Migration 056 not applied yet — retry with the legacy column set.
      const legacy = await supabase
        .from("seo_campaigns")
        .select("id, url, tier_name, tier_price, status, audit_json, competitors_json, location, created_at")
        .eq("id", id)
        .maybeSingle();
      if (!legacy.error && legacy.data) data = legacy.data as unknown as CampaignRow;
    }

    if (!data) {
      return NextResponse.json(
        { error: "Audit not found. Check the link with your agency." },
        { status: 404 }
      );
    }

    // Revoked links return 404 — indistinguishable from a wrong URL.
    if (data.share_enabled === false) {
      return NextResponse.json(
        { error: "Audit not found. Check the link with your agency." },
        { status: 404 }
      );
    }

    const audit = (data.audit_json ?? {}) as AuditShape;
    const homepage = audit.homepage;
    const body = homepageMarkdown(homepage);
    const keyword = brandKeyword(audit.url ?? data.url ?? "");
    const internalUrls = (audit.internalPages ?? [])
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
            return new URL(homepage.url ?? data.url).pathname.replace(/\/$/, "") || "/home";
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

    const severityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
    const allIssues = [
      ...(audit.technicalIssues ?? []).map((i) => ({ ...i, category: "Technical" })),
      ...(audit.onPageIssues ?? []).map((i) => ({ ...i, category: "On-Page" })),
    ].sort(
      (a, b) =>
        (severityOrder[a.severity] ?? 3) - (severityOrder[b.severity] ?? 3)
    );

    // Competitor benchmarks — the same-engine scores stored at generation
    // time (competitors.ts enriches each crawl with SEO/AEO/GEO scores).
    const competitors = (Array.isArray(data.competitors_json)
      ? data.competitors_json
      : []) as {
      competitorUrl: string;
      seoScore?: number | null;
      aeoScore?: number | null;
      geoScore?: number | null;
      competitorWordCount?: number | null;
      crawled?: boolean;
    }[];

    return NextResponse.json({
      url: audit.url ?? data.url,
      location: audit.location ?? data.location ?? null,
      tierName: data.tier_name,
      tierPrice: data.tier_price,
      status: data.status,
      scannedAt: audit.scannedAt ?? data.created_at,
      overallScore: audit.overallScore ?? null,
      pageSpeedScore: audit.pageSpeedScore ?? null,
      wordCount: homepage?.wordCount ?? null,
      loadTimeMs: homepage?.loadTimeMs ?? null,
      pagesCrawled: (audit.internalPages?.length ?? 0) + 1,
      technicalIssues: audit.technicalIssues ?? [],
      onPageIssues: audit.onPageIssues ?? [],
      contentGaps: audit.contentGaps ?? [],
      issues: allIssues,
      seoContent: seo,
      aeoGeo: aeo,
      brandKeyword: keyword,
      hasContentScores: seo !== null,
      competitors,
    });
  } catch (err) {
    console.error("[public-audit]", err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: "Could not load the audit report." },
      { status: 500 }
    );
  }
}
