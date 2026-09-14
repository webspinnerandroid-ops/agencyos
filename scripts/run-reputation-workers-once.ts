// scripts/run-reputation-workers-once.ts
// One-off CLI to trigger BOTH reputation workers immediately — the same code
// paths as the scheduled Inngest jobs — so you can verify end to end without
// waiting for the cron:
//
//   1. syncGbpReviews   (hourly at :23)  — pulls reviews from Google into
//      gbp_reviews, fires in-app notifications, pre-drafts 1-2★ replies, and
//      pushes 1★ alerts to any configured Slack/Discord webhooks.
//   2. reputationDigest (Mondays 10:00)  — builds the weekly digest email
//      (including the reply-to-note section) and sends it via Resend.
//
// Usage: cd agency-os && set -a && . ./.env.local && node scripts/run-reputation-workers-once.cjs
//
// Build: npx esbuild scripts/run-reputation-workers-once.ts --bundle \
//          --platform=node --format=cjs \
//          --alias:@=./src --external:next/headers \
//          --outfile=scripts/run-reputation-workers-once.cjs

import { createClient } from "@supabase/supabase-js";
import {
  listConnectedGbpPairs,
  runGbpReviewSync,
  type ServiceClient,
} from "../src/lib/gbp/sweep";
import { runWeeklyReputationDigest } from "../src/lib/inngest/functions/reputationDigestEmail";

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  const db = supabase as unknown as ServiceClient;

  // ---- 1. Review sync (same sweep as the hourly Inngest worker) ----
  console.log("== 1. GBP review sync (same code path as the hourly cron) ==");
  const pairs = await listConnectedGbpPairs(supabase);
  console.log(`   connected tenant/workspace pairs: ${pairs.length}`);
  const sync = await runGbpReviewSync(db, pairs, (_name, fn) => fn());
  if (sync.status === "skipped") {
    console.log(`   skipped: ${sync.message}`);
  } else {
    console.log(
      `   pairs ok: ${sync.pairsOk}/${sync.pairsProcessed} · new reviews: ${sync.newReviews}`
    );
    for (const r of sync.results ?? []) {
      const flag = r.ok ? "ok" : "FAIL";
      console.log(
        `   [${flag}] tenant ${r.tenantId.slice(0, 8)}… ws ${(r.workspaceId ?? "-").slice(0, 8)} — ${r.listings} listing(s), ${r.newReviews} new${r.error ? ` — ${r.error}` : ""}`
      );
    }
  }

  // ---- 2. Weekly digest (same engine as the Monday cron) ----
  console.log("\n== 2. Weekly reputation digest (same code path as the Monday cron) ==");
  const digest = await runWeeklyReputationDigest(supabase);
  console.log(
    `   tenants considered: ${digest.tenantsConsidered} · emailed: ${digest.tenantsEmailed} · recipients: ${digest.recipients}`
  );
  console.log(
    `   skipped (no news / no key): ${digest.skippedNoNews} · send failures: ${digest.sendFailures}`
  );

  console.log("\nDone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
