import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";

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

    const targetKeywords: { keyword?: string }[] =
      campaign.campaign_json.targetKeywords ?? [];
    const keywords = targetKeywords
      .map((k) => k.keyword?.trim())
      .filter((k): k is string => Boolean(k));

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

    // Match each target keyword to the GSC query that exactly equals it, or
    // that contains it (preferring the row with the most impressions).
    const rankings: Record<
      string,
      { position: number; impressions: number; clicks: number; query: string }
    > = {};

    for (const kw of keywords) {
      const k = kw.toLowerCase();
      let best: (typeof rows)[number] | null = null;
      for (const r of rows) {
        const q = (r.query ?? "").toLowerCase();
        if (!q) continue;
        if (q === k || q.includes(k) || k.includes(q)) {
          if (
            !best ||
            (r.impressions ?? 0) > (best.impressions ?? 0)
          ) {
            best = r;
          }
        }
      }
      if (best && best.position != null) {
        rankings[kw] = {
          position: Math.round(best.position * 10) / 10,
          impressions: best.impressions ?? 0,
          clicks: best.clicks ?? 0,
          query: best.query ?? "",
        };
      }
    }

    return NextResponse.json({ rankings, fetchedAt: new Date().toISOString() });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
