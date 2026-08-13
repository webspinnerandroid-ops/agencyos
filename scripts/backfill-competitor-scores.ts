// scripts/backfill-competitor-scores.ts
// One-off CLI for backfilling competitor SEO/AEO/GEO scores. Delegates to the
// shared src/lib/seo/competitor-backfill.ts (also used by the scheduled Inngest
// job) so the two can never drift.
//
// Usage: cd agency-os && set -a && . ./.env.local
//   node scripts/backfill-competitor-scores.cjs            # dry run
//   node scripts/backfill-competitor-scores.cjs --apply    # write results

import { backfillCompetitorScores } from "../src/lib/seo/competitor-backfill";

const APPLY = process.argv.includes("--apply");

async function main() {
  const stats = await backfillCompetitorScores({
    apply: APPLY,
    limit: 500,
    onLog: (m) => console.log(m),
  });

  console.log(
    `\nDone. ${APPLY ? "APPLIED" : "DRY RUN (use --apply to write)"}\n` +
      `  rows touched: ${stats.rowsTouched}\n` +
      `  competitor entries scored: ${stats.scored}\n` +
      `  already scored (skipped): ${stats.skipped}\n` +
      `  unreachable (marked crawled=false): ${stats.unreachable}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
