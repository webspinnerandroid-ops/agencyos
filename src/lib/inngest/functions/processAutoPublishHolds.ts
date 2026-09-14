import { inngest } from "@/lib/inngest/client";
import { processDueHolds } from "@/lib/content-map-autopublish";

/**
 * Inngest cron — process expired auto-publish holds.
 *
 * The 15-minute undo window on auto-published content-map rows ends with
 * `processDueHolds()` (content-map-autopublish.ts): held drafts are approved
 * and handed to WordPress (status "future" for the planned date) or queued
 * for the social publish cron.
 *
 * In this deployment the module's in-process timer sweeps every 60s, so this
 * cron is a redundancy — but it is the load-bearing path on a serverless
 * deploy where there is no long-lived Node process to own the interval. Both
 * paths drive the same seam; `processDueHolds()` claims each hold before
 * acting, so a timer and this cron racing the same hold can never
 * double-publish.
 */
export const processAutoPublishHolds = inngest.createFunction(
  {
    id: "process-auto-publish-holds",
    name: "Process Auto-Publish Holds",
    triggers: [
      {
        // Every minute — the hold window is short, and expiry should land
        // close to its promised time. (The publish cron itself runs every 5.)
        cron: "* * * * *",
      },
    ],
  },
  async ({ step }) => {
    const results = await step.run("process-due-holds", async () => {
      try {
        return await processDueHolds();
      } catch (error) {
        console.error(
          "[processAutoPublishHolds] Hold pass failed:",
          error instanceof Error ? error.message : error
        );
        return [];
      }
    });

    if (results.length === 0) {
      return { message: "No expired auto-publish holds", count: 0 };
    }

    const failed = results.filter((r) => !r.ok);
    return {
      message: `Processed ${results.length} expired hold(s)${failed.length ? `, ${failed.length} failed` : ""}`,
      count: results.length,
      results,
    };
  }
);
