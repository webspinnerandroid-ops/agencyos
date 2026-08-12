import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { getCurrentWorkspaceId } from "@/lib/workspace";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * GET /api/analytics/seo?clientId=… — per-workspace SEO analytics for
 * monitoring client websites: audit history, content SEO/AEO-GEO scores,
 * and publish counts. Mirrors the calendar's workspace scoping (legacy
 * workspace_id = NULL rows appear in every workspace view).
 */
export async function GET(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    if (!tenantId) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const workspaceId = (await getCurrentWorkspaceId().catch(() => null)) ?? null;
    const clientId = request.nextUrl.searchParams.get("clientId") || null;

    const supabase = await createServiceClient();

    // 1. Audits (SEO campaigns).
    let auditsQuery = supabase
      .from("seo_campaigns")
      .select("id, url, tier_name, tier_level, status, created_at, client_id")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });
    if (clientId) auditsQuery = auditsQuery.eq("client_id", clientId);
    const { data: audits } = await auditsQuery.limit(100);

    // 2. Content: score distribution + publish counts. Use denormalized
    // columns only — never the JSON content blob (it's megabytes of base64).
    let postsQuery = supabase
      .from("posts")
      .select("id, status, type, seo_score, aeo_geo_score, cms_published_at, cms_slug, client_id, created_at")
      .eq("tenant_id", tenantId);
    if (workspaceId) {
      postsQuery = postsQuery.or(`workspace_id.is.null,workspace_id.eq.${workspaceId}`);
    }
    if (clientId) postsQuery = postsQuery.eq("client_id", clientId);
    const { data: posts } = await postsQuery.order("created_at", { ascending: false }).limit(500);

    const rows = (posts ?? []) as {
      status: string;
      type: string | null;
      seo_score: number | null;
      aeo_geo_score: number | null;
      cms_published_at: string | null;
      cms_slug: string | null;
      created_at: string | null;
    }[];

    const scored = rows.filter((p) => typeof p.seo_score === "number");
    const aeoScored = rows.filter((p) => typeof p.aeo_geo_score === "number");
    const avg = (arr: number[]) =>
      arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10 : null;

    const byStatus: Record<string, number> = {};
    let publishedOnSite = 0;
    for (const p of rows) {
      byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;
      if (p.cms_published_at) publishedOnSite += 1;
    }

    // Score bands (Rank Math style traffic lights).
    const bands = { green: 0, yellow: 0, red: 0 };
    for (const p of scored) {
      const s = p.seo_score as number;
      if (s >= 81) bands.green += 1;
      else if (s >= 50) bands.yellow += 1;
      else bands.red += 1;
    }

    const recent = rows
      .slice(0, 12)
      .map((p) => ({
        status: p.status,
        type: p.type ?? "unknown",
        seo_score: p.seo_score,
        aeo_geo_score: p.aeo_geo_score,
        cms_published_at: p.cms_published_at,
        cms_slug: p.cms_slug,
        created_at: p.created_at,
      }));

    return NextResponse.json({
      audits: (audits ?? []).slice(0, 12),
      summary: {
        totalPosts: rows.length,
        avgSeoScore: avg(scored.map((p) => p.seo_score as number)),
        avgAeoGeoScore: avg(aeoScored.map((p) => p.aeo_geo_score as number)),
        byStatus,
        bands,
        publishedOnSite,
        auditsCount: (audits ?? []).length,
      },
      recent,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Internal error" }, { status: 500 });
  }
}
