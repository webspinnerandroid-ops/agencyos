import { inngest } from "@/lib/inngest/client";
import { createClient } from "@supabase/supabase-js";
import { rescoreCompetitorEntries } from "@/lib/seo/competitor-backfill";

/**
 * Monthly competitor-benchmark refresh (1st of the month, 07:00 UTC).
 *
 * The daily scoreCompetitors job only backfills entries that were never
 * scored (dead/blocked at audit time). This one re-scrapes EVERY stored
 * competitor for every campaign so each workspace's benchmark stays current
 * month over month — same engines (SEO + AEO/GEO), no LLM cost, no
 * client-site re-crawl. Each refreshed entry is stamped with `scoredAt` so
 * the UI can show "last benchmarked".
 */
export const refreshCompetitorBenchmarks = inngest.createFunction(
  {
    id: "refresh-competitor-benchmarks",
    name: "Refresh monthly competitor SEO/AEO/GEO benchmarks",
    triggers: [{ cron: "0 7 1 * *" }], // 1st of each month, 07:00 UTC
  },
  async ({ step }) => {
    return await step.run("refresh-all", async () => {
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { persistSession: false, autoRefreshToken: false } }
      );

      const { data: rows, error } = await supabase
        .from("seo_campaigns")
        .select("id, url, competitors_json")
        .limit(1000);

      if (error) throw new Error(`Query failed: ${error.message}`);

      let campaignsUpdated = 0;
      let competitorsScored = 0;
      let unreachable = 0;
      for (const row of rows ?? []) {
        const comps = Array.isArray(row.competitors_json)
          ? row.competitors_json
          : [];
        if (comps.length === 0) continue;
        const res = await rescoreCompetitorEntries(comps);
        campaignsUpdated++;
        competitorsScored += res.scored;
        unreachable += res.unreachable;
        const { error: upErr } = await supabase
          .from("seo_campaigns")
          .update({ competitors_json: res.entries })
          .eq("id", row.id);
        if (upErr) {
          console.error(
            `[refresh-competitors] update failed for ${row.id}: ${upErr.message}`
          );
        }
      }

      return {
        success: true,
        campaignsUpdated,
        competitorsScored,
        unreachable,
      };
    });
  }
);
