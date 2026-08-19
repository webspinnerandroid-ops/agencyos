import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { matchRankings, targetKeywordsOf } from "@/lib/seo/keyword-rankings";
import {
  type ConnectionRecord,
  encodeTokenBundle,
  getAccessToken,
} from "@/lib/connections";
import { fetchSCKeywordRankings } from "@/lib/site-metrics";

/**
 * GET /api/seo/rankings?campaignId=<id>
 * Returns measured current positions (from Search Console keyword_rankings)
 * for the campaign's target keywords, matched by query string. Unmatched
 * keywords are simply absent — the UI shows "—" for them.
 *
 * Data freshness: keyword_rankings is populated by the daily syncSiteMetrics
 * cron. To keep the Current Rank column live between cron runs, this route
 * triggers an on-demand pull whenever the stored rows are older than
 * RANKINGS_FRESH_MS (or missing entirely). The pull reuses the tenant's
 * connected Search Console OAuth token and upserts fresh rows. If there is
 * no connected SC source, or Google is unreachable, it falls back to the
 * cached rows so the page still renders.
 */
const RANKINGS_FRESH_MS = 6 * 60 * 60 * 1000; // 6 hours

interface RankingRowWithFetchedAt {
  query: string;
  position: number | null;
  impressions: number | null;
  clicks: number | null;
  fetched_at: string | null;
}

/**
 * Pull the latest per-query Search Console data for every connected SC
 * connection of this tenant and upsert it (advancing fetched_at). Best
 * effort: any failure is logged and swallowed so callers degrade to cache.
 */
async function pullLiveRankings(
  tenantId: string,
  supabase: Awaited<ReturnType<typeof createServiceClient>>
): Promise<void> {
  const { data: connections, error } = await supabase
    .from("tenant_connections")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("provider", "search_console")
    .eq("connected", true)
    .not("selected_resource", "is", null)
    .limit(25);

  if (error || !connections?.length) return;

  for (const conn of connections as ConnectionRecord[]) {
    const resource = conn.selected_resource!;
    try {
      const { accessToken, fresh } = await getAccessToken(conn);
      if (fresh) {
        await supabase
          .from("tenant_connections")
          .update({ encrypted_token: encodeTokenBundle(fresh) })
          .eq("id", conn.id);
      }
      const kwRows = await fetchSCKeywordRankings(accessToken, resource);
      if (kwRows.length === 0) continue;
      const { error: upsertError } = await supabase
        .from("keyword_rankings")
        .upsert(
          kwRows.map((r) => ({
            tenant_id: tenantId,
            resource,
            query: r.query,
            clicks: r.clicks,
            impressions: r.impressions,
            ctr: r.ctr,
            position: r.position,
            fetched_at: new Date().toISOString(),
          })),
          { onConflict: "tenant_id,resource,query" }
        );
      if (upsertError) {
        console.error(
          `[rankings] on-demand upsert (${tenantId} / ${resource}):`,
          upsertError.message
        );
      }
    } catch (pullErr) {
      // Cache fallback — never fail the page because a live pull failed.
      console.error(
        `[rankings] on-demand SC pull failed (${tenantId} / ${resource}):`,
        (pullErr as Error).message
      );
    }
  }
}

export async function GET(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    const campaignId = request.nextUrl.searchParams.get("campaignId");
    if (!campaignId) {
      return NextResponse.json({ rankings: {} });
    }

    const supabase = await createServiceClient();

    const { data: campaign, error: campaignError } = await supabase
      .from("seo_campaigns")
      .select("campaign_json")
      .eq("id", campaignId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (campaignError || !campaign?.campaign_json) {
      return NextResponse.json({ rankings: {} });
    }

    const keywords = targetKeywordsOf(campaign.campaign_json);
    if (keywords.length === 0) {
      return NextResponse.json({ rankings: {} });
    }

    const now = Date.now();

    // Freshness check: newest fetched_at among this tenant's SC rows.
    const { data: newestRow, error: newestError } = await supabase
      .from("keyword_rankings")
      .select("fetched_at")
      .eq("tenant_id", tenantId)
      .order("fetched_at", { ascending: false })
      .limit(1)
      .maybeSingle<RankingRowWithFetchedAt>();

    const lastFetched = newestRow?.fetched_at
      ? new Date(newestRow.fetched_at).getTime()
      : 0;
    const stale = Number.isNaN(lastFetched) || now - lastFetched > RANKINGS_FRESH_MS;

    if (!newestError && stale) {
      await pullLiveRankings(tenantId, supabase);
    }

    const { data: rows, error: rowsError } = await supabase
      .from("keyword_rankings")
      .select("query, position, impressions, clicks")
      .eq("tenant_id", tenantId)
      .limit(3000);

    if (rowsError || !rows) {
      return NextResponse.json({ rankings: {} });
    }

    return NextResponse.json({
      rankings: matchRankings(keywords, rows),
      fetchedAt: new Date().toISOString(),
      live: stale, // true when this response triggered (or attempted) a live pull
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
