// scripts/sync-keyword-rankings.ts
// One-off CLI that runs the Search Console portion of the syncSiteMetrics
// job immediately: daily metrics into traffic_snapshots and per-query
// positions into keyword_rankings.
//
// Usage: cd agency-os && set -a && . ./.env.local
//   node scripts/sync-keyword-rankings.cjs

import { createClient } from "@supabase/supabase-js";
import {
  decodeTokenBundle,
  encodeTokenBundle,
  getAccessToken,
} from "../src/lib/connections";
import {
  fetchSCDailyMetrics,
  fetchSCKeywordRankings,
} from "../src/lib/site-metrics";

async function main() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  const { data: conns, error } = await sb
    .from("tenant_connections")
    .select("*")
    .eq("provider", "search_console")
    .eq("connected", true);

  if (error) throw new Error(error.message);
  console.log(`Found ${conns?.length ?? 0} Search Console connection(s)`);

  for (const conn of conns ?? []) {
    const resource = conn.selected_resource;
    if (!resource) {
      console.log(`  ${conn.tenant_id}: no selected_resource, skipping`);
      continue;
    }
    try {
      const { accessToken, fresh } = await getAccessToken(conn);
      if (fresh) {
        await sb
          .from("tenant_connections")
          .update({ encrypted_token: encodeTokenBundle(fresh) })
          .eq("id", conn.id);
      }

      // Daily metrics
      const daily = await fetchSCDailyMetrics(accessToken, resource);
      if (daily.length) {
        await sb.from("traffic_snapshots").upsert(
          daily.map((r) => ({
            tenant_id: conn.tenant_id,
            provider: "search_console",
            resource,
            metric_date: r.date,
            clicks: r.clicks,
            impressions: r.impressions,
            ctr: r.ctr,
            position: r.position,
          })),
          { onConflict: "tenant_id,provider,resource,metric_date" }
        );
      }

      // Per-query rankings
      const kw = await fetchSCKeywordRankings(accessToken, resource);
      if (kw.length) {
        const { error: kwErr } = await sb.from("keyword_rankings").upsert(
          kw.map((r) => ({
            tenant_id: conn.tenant_id,
            resource,
            query: r.query,
            clicks: r.clicks,
            impressions: r.impressions,
            ctr: r.ctr,
            position: r.position,
          })),
          { onConflict: "tenant_id,resource,query" }
        );
        if (kwErr) console.error(`  keyword upsert error: ${kwErr.message}`);
      }

      await sb
        .from("tenant_connections")
        .update({ last_synced_at: new Date().toISOString() })
        .eq("id", conn.id);

      console.log(
        `  ${resource}: ${daily.length} daily rows, ${kw.length} keyword rows`
      );
    } catch (e) {
      console.error(
        `  ${conn.tenant_id} ${resource}: ${(e as Error).message}`
      );
    }
  }

  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
