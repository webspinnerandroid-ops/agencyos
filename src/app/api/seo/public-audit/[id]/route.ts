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
    if (!UUID_RE.test(id)) {
      return NextResponse.json(
        { error: "Invalid audit link." },
        { status: 400 }
      );
    }

    const supabase = await createServiceClient();
    const { data, error } = await supabase
      .from("seo_campaigns")
      .select("id, url, tier_name, tier_price, status, audit_json, location, created_at")
      .eq("id", id)
      .maybeSingle();

    if (error || !data) {
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
    });
  } catch (err) {
    console.error("[public-audit]", err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: "Could not load the audit report." },
      { status: 500 }
    );
  }
}
