import { inngest } from "@/lib/inngest/client";
import { processDueRetries } from "@/lib/publishing/retryFailedPublishes";

/**
 * Inngest cron — retry failed publishes with backoff.
 *
 * Drives `processDueRetries()` (publishing/retryFailedPublishes.ts): failed
 * posts are retried on a 5 min → 30 min → 2 h ladder, and posts that exhaust
 * the ladder are escalated (alert notification + surfaced in the Scheduled
 * panel). The in-process sweeper shares this seam in long-lived deployments;
 * each due post is claimed before the retry runs, so both drivers can race
 * without double-publishing.
 */
export const processPublishRetries = inngest.createFunction(
  {
    id: "process-publish-retries",
    name: "Retry Failed Publishes",
    triggers: [
      {
        // Every minute — the shortest backoff step is 5 minutes, so a
        // per-minute sweep keeps retries close to their promised time.
        cron: "* * * * *",
      },
    ],
  },
  async ({ step }) => {
    const results = await step.run("process-due-retries", async () => {
      try {
        return await processDueRetries();
      } catch (error) {
        console.error(
          "[processPublishRetries] pass failed:",
          error instanceof Error ? error.message : error
        );
        return [];
      }
    });

    if (results.length === 0) {
      return { message: "No failed publishes due for retry", count: 0 };
    }

    const ok = results.filter((r) => r.action === "retried_ok").length;
    const stillFailing = results.filter((r) => r.action === "retried_failed").length;
    const escalated = results.filter((r) => r.action === "escalated").length;
    return {
      message: `Retried ${results.length}: ${ok} recovered, ${stillFailing} still failing, ${escalated} escalated`,
      count: results.length,
      ok,
      stillFailing,
      escalated,
      results,
    };
  }
);
