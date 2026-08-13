import { inngest } from "@/lib/inngest/client";
import { createClient as createServiceRoleClient } from "@supabase/supabase-js";
import {
  type ConnectionRecord,
  encodeTokenBundle,
  getAccessToken,
} from "@/lib/connections";
import { fetchGADailyMetrics, fetchSCDailyMetrics } from "@/lib/site-metrics";

/**
 * Daily site-metrics sync — pulls real GA4 and Search Console numbers for
 * every connected tenant into `traffic_snapshots` so the Analytics page shows
 * real site traffic instead of nothing (the mock generator was removed).
 */
export const syncSiteMetrics = inngest.createFunction(
  {
    id: "sync-site-metrics",
    name: "Sync GA4 & Search Console Site Metrics",
    triggers: [{ cron: "30 5 * * *" }], // every day 05:30 UTC
  },
  async ({ step }) => {
    const supabase = createServiceRoleClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );

    const connections = await step.run("fetch-connected", async () => {
      const { data, error } = await supabase
        .from("tenant_connections")
        .select("*")
        .not("selected_resource", "is", null)
        .eq("connected", true)
        .limit(500);
      if (error) {
        console.error("[syncSiteMetrics] fetch connections:", error.message);
        return [];
      }
      return (data ?? []) as ConnectionRecord[];
    });

    let updated = 0;
    let errors = 0;

    for (const conn of connections) {
      const result = await step.run(
        `sync-${conn.tenant_id}-${conn.provider}`,
        async (): Promise<{ inserted: number; error?: string }> => {
        try {
          const { accessToken, fresh } = await getAccessToken(conn);
          if (fresh) {
            await supabase
              .from("tenant_connections")
              .update({ encrypted_token: encodeTokenBundle(fresh) })
              .eq("id", conn.id);
          }

          const resource = conn.selected_resource!;
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
            conn.provider === "google_analytics"
              ? (await fetchGADailyMetrics(accessToken, resource)).map((r) => ({
                  tenant_id: conn.tenant_id,
                  provider: "google_analytics" as const,
                  resource,
                  metric_date: r.date,
                  sessions: r.sessions,
                  users: r.users,
                  pageviews: r.pageviews,
                  engagement_rate: r.engagementRate,
                }))
              : (await fetchSCDailyMetrics(accessToken, resource)).map((r) => ({
                  tenant_id: conn.tenant_id,
                  provider: "search_console" as const,
                  resource,
                  metric_date: r.date,
                  clicks: r.clicks,
                  impressions: r.impressions,
                  ctr: r.ctr,
                  position: r.position,
                }));

          if (rows.length === 0) return { inserted: 0 };
          const { error } = await supabase
            .from("traffic_snapshots")
            .upsert(rows, { onConflict: "tenant_id,provider,metric_date" });
          if (error) throw new Error(error.message);

          await supabase
            .from("tenant_connections")
            .update({ last_synced_at: new Date().toISOString() })
            .eq("id", conn.id);
          return { inserted: rows.length };
        } catch (err) {
          console.error(
            `[syncSiteMetrics] ${conn.provider} for tenant ${conn.tenant_id}:`,
            (err as Error).message
          );
          return { inserted: 0, error: (err as Error).message };
        }
      });
      updated += result.inserted;
      if (result.error) errors += 1;
    }

    return { connections: connections.length, updated, errors };
  }
);
