import { inngest } from "@/lib/inngest/client";
import { backfillCompetitorScores } from "@/lib/seo/competitor-backfill";

/**
 * Daily competitor-score backfill. The crawl scores competitors at audit time,
 * but a competitor that was unreachable, timed out, or bot-blocked at that
 * moment gets saved without scores. This catches those up the next day (and
 * any audit that somehow persisted unscored competitors) so benchmarks stop
 * showing blank cells.
 */
export const scoreCompetitors = inngest.createFunction(
  {
    id: "score-competitors",
    name: "Backfill competitor SEO/AEO/GEO benchmark scores",
    triggers: [{ cron: "0 6 * * *" }], // every day 06:00 UTC
  },
  async ({ step }) => {
    return await step.run("backfill", async () => {
      const stats = await backfillCompetitorScores({ apply: true, limit: 500 });
      return { success: true, ...stats };
    });
  }
);
