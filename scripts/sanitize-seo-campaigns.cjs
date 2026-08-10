#!/usr/bin/env node
/**
 * sanitize-seo-campaigns.cjs
 *
 * One-off data backfill: makes existing seo_campaigns.campaign_json rows
 * consistent with the generator's data-integrity guard (added 2026-08-10).
 * For every stored campaign it:
 *   - nulls targetKeywords[].currentRanking  (the audit never measures
 *     rankings, so any stored value was invented by the model)
 *   - clamps targetKeywords[].searchVolume   (must be a non-negative number;
 *     null/NaN/negative -> 0, so volumes can never masquerade as measured)
 *
 * Usage (run from repo root or anywhere; env is read from .env.local):
 *   node scripts/sanitize-seo-campaigns.cjs              # dry run (no writes)
 *   node scripts/sanitize-seo-campaigns.cjs --apply      # write changes
 *   node scripts/sanitize-seo-campaigns.cjs --limit 50   # cap rows examined
 */

const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Env: read .env.local manually (project convention — no dotenv dependency).
// Local checkout first, then the VPS path as a fallback.
// ---------------------------------------------------------------------------
function loadEnv() {
  const candidates = [
    path.join(__dirname, "..", ".env.local"),
    "/var/www/vhosts/blissmedialab.com/agency-os/.env.local",
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    const env = {};
    for (const line of fs.readFileSync(p, "utf-8").split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    }
    return env;
  }
  return {};
}

const APPLY = process.argv.includes("--apply");
const LIMIT_ARG = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = LIMIT_ARG ? parseInt(LIMIT_ARG.split("=")[1], 10) : null;

const env = loadEnv();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local"
  );
  process.exit(1);
}
const sb = createClient(url, serviceKey);

// ---------------------------------------------------------------------------
// Sanitization — mirrors src/app/api/seo/generate-campaign/route.ts guard.
// Returns what was changed, or null if the campaign is already clean.
// ---------------------------------------------------------------------------
function sanitizeCampaign(campaign) {
  if (!campaign || typeof campaign !== "object") return null;
  const keywords = Array.isArray(campaign.targetKeywords)
    ? campaign.targetKeywords
    : [];
  let rankingNulled = 0;
  let volumeClamped = 0;

  for (const kw of keywords) {
    if (!kw || typeof kw !== "object") continue;

    // The auditor produces no measured rankings, so stored currentRanking
    // was invented by the model — null it out.
    if (kw.currentRanking != null) {
      kw.currentRanking = null;
      rankingNulled++;
    }

    // Volumes must be non-negative numbers; anything else is not data.
    if (
      typeof kw.searchVolume !== "number" ||
      Number.isNaN(kw.searchVolume) ||
      kw.searchVolume < 0
    ) {
      kw.searchVolume = 0;
      volumeClamped++;
    }
  }

  if (rankingNulled === 0 && volumeClamped === 0) return null;
  return { rankingNulled, volumeClamped };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
(async () => {
  console.log(
    APPLY
      ? "APPLY mode — writing sanitized campaign_json rows."
      : "DRY RUN — no writes. Re-run with --apply to update."
  );
  console.log(`Target: ${url}`);

  const PAGE_SIZE = 500;
  let offset = 0;
  let processed = 0;
  let dirtyRows = 0;
  let updated = 0;
  let failed = 0;
  let rankingNulled = 0;
  let volumeClamped = 0;
  let firstDirty = 5; // show a few examples in dry-run

  while (true) {
    const { data: rows, error } = await sb
      .from("seo_campaigns")
      .select("id, campaign_json")
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      console.error(`Fetch error: ${error.message}`);
      process.exit(1);
    }
    if (!rows || rows.length === 0) break;

    for (const row of rows) {
      processed++;

      const result = sanitizeCampaign(row.campaign_json);
      if (!result) continue;
      dirtyRows++;
      rankingNulled += result.rankingNulled;
      volumeClamped += result.volumeClamped;

      if (APPLY) {
        const { error: updErr } = await sb
          .from("seo_campaigns")
          .update({ campaign_json: row.campaign_json })
          .eq("id", row.id);
        if (updErr) {
          failed++;
          console.error(`  UPDATE FAILED ${row.id}: ${updErr.message}`);
        } else {
          updated++;
        }
      } else if (firstDirty > 0) {
        firstDirty--;
        console.log(`  [dry] ${row.id} would be sanitized`);
      }
    }

    if (LIMIT && processed >= LIMIT) break;
    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  console.log("\n--- Summary ---");
  console.log(`Campaigns examined: ${processed}`);
  console.log(`Rows with invented/unclamped metrics: ${dirtyRows}`);
  console.log(`currentRanking values nulled: ${rankingNulled}`);
  console.log(`searchVolume values clamped: ${volumeClamped}`);
  if (APPLY) {
    console.log(`Rows updated: ${updated} (${failed} failed)`);
  } else {
    console.log("No writes performed (dry run).");
  }
})();
