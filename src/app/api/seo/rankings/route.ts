import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { matchRankings, targetKeywordsOf } from "@/lib/seo/keyword-rankings";

/**
 * GET /api/seo/rankings?campaignId=<id>
 * Returns measured current positions (from Search Console keyword_rankings)
 * for the campaign's target keywords, matched by query string. Unmatched
 * keywords are simply absent — the UI shows "—" for them.
 */
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
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
