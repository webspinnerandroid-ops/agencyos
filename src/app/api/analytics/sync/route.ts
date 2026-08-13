import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import {
  type ConnectionProvider,
  type ConnectionRecord,
  getAccessToken,
} from "@/lib/connections";
import { fetchGADailyMetrics, fetchSCDailyMetrics } from "@/lib/site-metrics";

/**
 * On-demand site-metrics sync for one provider + resource (GA4 property or
 * Search Console site). Powers the Traffic tab's "Sync this property" button
 * so a freshly picked property gets data immediately instead of waiting for
 * the 05:30 UTC daily cron.
 */
export async function POST(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    const supabase = await createServiceClient();

    const body = (await request.json().catch(() => ({}))) as {
      provider?: ConnectionProvider;
      resource?: string;
    };
    const provider = body.provider;
    if (provider !== "google_analytics" && provider !== "search_console") {
      return NextResponse.json(
        { error: "provider must be google_analytics or search_console" },
        { status: 400 }
      );
    }

    const { data: conn, error } = await supabase
      .from("tenant_connections")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("provider", provider)
      .maybeSingle();
    if (error || !conn) {
      return NextResponse.json(
        { error: error?.message ?? "Not connected." },
        { status: 404 }
      );
    }

    const resource = body.resource || conn.selected_resource;
    if (!resource) {
      return NextResponse.json(
        { error: "No property selected — pick a property first." },
        { status: 400 }
      );
    }

    const { accessToken } = await getAccessToken(conn as ConnectionRecord);

    type TrafficInsert = {
      tenant_id: string;
      provider: "google_analytics" | "search_console";
      resource: string;
      metric_date: string;
      sessions?: number | null;
      users?: number | null;
      pageviews?: number | null;
      engagement_rate?: number | null;
      clicks?: number | null;
      impressions?: number | null;
      ctr?: number | null;
      position?: number | null;
    };
    const rows: TrafficInsert[] =
      provider === "google_analytics"
        ? (await fetchGADailyMetrics(accessToken, resource)).map((r) => ({
            tenant_id: tenantId,
            provider: "google_analytics" as const,
            resource,
            metric_date: r.date,
            sessions: r.sessions,
            users: r.users,
            pageviews: r.pageviews,
            engagement_rate: r.engagementRate,
          }))
        : (await fetchSCDailyMetrics(accessToken, resource)).map((r) => ({
            tenant_id: tenantId,
            provider: "search_console" as const,
            resource,
            metric_date: r.date,
            clicks: r.clicks,
            impressions: r.impressions,
            ctr: r.ctr,
            position: r.position,
          }));

    if (rows.length === 0) {
      return NextResponse.json({
        synced: 0,
        resource,
        detail: "No data returned for this property in the 90-day window.",
      });
    }

    const { error: upsertErr } = await supabase.from("traffic_snapshots").upsert(
      rows,
      { onConflict: "tenant_id,provider,resource,metric_date" }
    );
    if (upsertErr) throw new Error(upsertErr.message);

    await supabase
      .from("tenant_connections")
      .update({ last_synced_at: new Date().toISOString() })
      .eq("id", conn.id);

    return NextResponse.json({ synced: rows.length, resource });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
