// scripts/run-auto-audit-once.ts
// One-off CLI to trigger the weekly auto-audit immediately — same code path as
// the scheduled Inngest job (autoAuditMonitoredSites) so results are identical.
// Use when you don't want to wait for Monday's cron.
//
// Usage: cd agency-os && set -a && . ./.env.local
//   node scripts/run-auto-audit-once.cjs
//
// Build: npx esbuild scripts/run-auto-audit-once.ts --bundle --platform=node \
//          --format=cjs --outfile=scripts/run-auto-audit-once.cjs

import { createClient } from "@supabase/supabase-js";
import { runAutoAudit } from "../src/lib/inngest/functions/autoAuditMonitoredSites";

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  console.log("Triggering weekly auto-audit now (same code path as Monday's cron)…");
  const outcome = await runAutoAudit(supabase);

  console.log(`\nDone.`);
  console.log(`  sites audited: ${outcome.audited}`);
  console.log(`  score changes: ${outcome.changed}`);
  console.log(`  skipped/failed: ${outcome.skipped}`);
  console.log(`  digest emails: ${outcome.emailed}`);
  for (const s of outcome.sites) {
    const flag = s.skipped ? "SKIP" : s.changed ? "CHANGED" : "ok";
    console.log(
      `  [${flag}] ${s.url} — SEO ${s.seo ?? "—"} / AEO ${s.aeo ?? "—"} / GEO ${s.geo ?? "—"} (combined ${s.combined ?? "—"})`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
