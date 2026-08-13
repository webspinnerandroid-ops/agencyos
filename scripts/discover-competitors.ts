// scripts/discover-competitors.ts
// One-off CLI that discovers real competitors (industry + location research)
// for campaigns whose competitors_json is empty, scores them with the same
// SEO + AEO/GEO engines, and writes them back.
//
// Usage: cd agency-os && set -a && . ./.env.local
//   node scripts/discover-competitors.cjs            # dry run
//   node scripts/discover-competitors.cjs --apply    # write results

import { discoverAndBackfillCompetitors } from "../src/lib/seo/competitor-backfill";

const APPLY = process.argv.includes("--apply");
const LIMIT = Number(process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? 500);

async function main() {
  const stats = await discoverAndBackfillCompetitors({
    apply: APPLY,
    limit: LIMIT,
    onLog: (m) => console.log(m),
  });

  console.log(
    `\nDone. ${APPLY ? "APPLIED" : "DRY RUN (use --apply to write)"}\n` +
      `  campaigns touched: ${stats.rowsTouched}\n` +
      `  competitors discovered + written: ${stats.discovered}\n` +
      `  still empty (discovery found nothing): ${stats.empty}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
