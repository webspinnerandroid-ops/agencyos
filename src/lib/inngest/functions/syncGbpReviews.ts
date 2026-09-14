import { inngest } from "@/lib/inngest/client";
import { createClient } from "@supabase/supabase-js";
import {
  listConnectedGbpPairs,
  runGbpReviewSync,
  type ServiceClient,
} from "@/lib/gbp/sweep";

/**
 * Hourly Google review sync — pulls fresh reviews for every connected
 * Business Profile listing into `gbp_reviews` snapshots and fires in-app
 * notifications for genuinely-new reviews (the baseline rule lives in
 * syncGbpReviewsForPair: a listing's first sync is silent apart from up to
 * three unanswered low-star reviews, so connecting a business doesn't spam
 * the bell with history). New 1-2★ reviews also get a Lana draft pre-written
 * so a reply is ready when the notification is opened.
 *
 * The sweep itself lives in lib/gbp/sweep.ts so the one-off verification
 * script (scripts/run-reputation-workers-once.ts) executes the exact same
 * code path — what you verify locally is what the cron runs.
 *
 * Cross-tenant by design: the sweep enumerates every connected tenant/
 * workspace pair, then each pair is processed with explicit tenant scoping.
 * Same trust model as the other allowlisted Inngest workers.
 */
export const syncGbpReviews = inngest.createFunction(
  {
    id: "sync-gbp-reviews",
    name: "Sync Google Business Profile Reviews",
    retries: 2,
    triggers: [{ cron: "23 * * * *" }], // hourly at :23, clear of the other jobs
  },
  async ({ step }) => {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
    const db = supabase as unknown as ServiceClient;

    const pairs = await step.run("list-connected-pairs", async () =>
      // Intentionally cross-tenant: this enumerates which tenant/workspace
      // pairs have connected listings. Every per-pair query inside
      // syncGbpReviewsForPair is tenant-scoped by explicit argument.
      listConnectedGbpPairs(supabase)
    );

    return await step.run("sync-all-pairs", () =>
      runGbpReviewSync(db, pairs, (_name, fn) => fn())
    );
  }
);
