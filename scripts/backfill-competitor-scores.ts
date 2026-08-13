// scripts/backfill-competitor-scores.ts
// One-off backfill: score every competitor already stored in
// seo_campaigns.competitors_json with the same SEO + AEO/GEO engines the
// crawl now uses (scoreCompetitorHtml), and merge the scores back in.
//
// Does NOT re-crawl the client site or touch the campaign itself — only the
// competitor entries that lack scores get fetched/scored.
//
// Usage: cd agency-os && set -a && . ./.env.local
//   node scripts/backfill-competitor-scores.cjs            # dry run
//   node scripts/backfill-competitor-scores.cjs --apply    # write results

import { createClient } from "@supabase/supabase-js";
import { scoreCompetitorHtml } from "../src/lib/seo/audit-report";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

const APPLY = process.argv.includes("--apply");

const USER_AGENT =
  "Mozilla/5.0 (compatible; AgencyOS-SeoAuditor/1.0; +https://agency-os.dev)";
const FETCH_TIMEOUT_MS = 15000;

interface CompetitorEntry {
  competitorUrl?: string;
  seoScore?: number | null;
  aeoScore?: number | null;
  geoScore?: number | null;
  competitorWordCount?: number | null;
  crawled?: boolean;
  [key: string]: unknown;
}

function normalizeUrl(u: string): string {
  let s = (u || "").trim().replace(/\\/g, "/");
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  return s;
}

function isScored(c: CompetitorEntry): boolean {
  return (
    typeof c.seoScore === "number" ||
    typeof c.aeoScore === "number" ||
    typeof c.geoScore === "number"
  );
}

const htmlCache = new Map<string, string | null>();

async function fetchOnce(url: string): Promise<string | null> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: controller.signal,
      redirect: "follow",
    });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function fetchHtml(url: string): Promise<string | null> {
  if (htmlCache.has(url)) return htmlCache.get(url) ?? null;
  // Transient network errors (timeouts, TLS hiccups) get one retry;
  // hard blocks (DNS, 403) settle on the first result.
  let html = await fetchOnce(url);
  if (html === null) {
    await sleep(800);
    html = await fetchOnce(url);
  }
  htmlCache.set(url, html);
  return html;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { data: rows, error } = await sb
    .from("seo_campaigns")
    .select("id, tenant_id, url, competitors_json")
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) {
    console.error("Query failed:", error.message);
    process.exit(1);
  }

  let rowsChanged = 0;
  let entriesScored = 0;
  let entriesSkipped = 0;
  let fetchFailures = 0;

  for (const row of rows ?? []) {
    const comps: CompetitorEntry[] = Array.isArray(row.competitors_json)
      ? row.competitors_json
      : [];
    if (comps.length === 0) continue;

    let rowDirty = false;
    for (const c of comps) {
      if (!c || typeof c !== "object") continue;
      const rawUrl = c.competitorUrl;
      if (!rawUrl) continue;
      if (isScored(c)) {
        entriesSkipped++;
        continue;
      }
      const url = normalizeUrl(rawUrl);
      const html = await fetchHtml(url);
      if (!html) {
        fetchFailures++;
        // Honest marker so the report can say why a cell is blank.
        c.seoScore = null;
        c.aeoScore = null;
        c.geoScore = null;
        c.competitorWordCount = null;
        c.crawled = false;
        rowDirty = true;
        continue;
      }
      const s = scoreCompetitorHtml(html, url);
      c.seoScore = s.seoScore;
      c.aeoScore = s.aeoScore;
      c.geoScore = s.geoScore;
      c.competitorWordCount = s.wordCount;
      c.crawled = s.crawled;
      entriesScored++;
      rowDirty = true;
      await sleep(250); // polite crawl spacing
    }

    if (!rowDirty) continue;
    rowsChanged++;
    if (!APPLY) {
      console.log(
        `[dry] would update ${row.id} (${row.url}): ${comps.length} competitors`
      );
      continue;
    }
    const { error: upErr } = await sb
      .from("seo_campaigns")
      .update({ competitors_json: comps })
      .eq("id", row.id);
    if (upErr) {
      console.error(`[fail] ${row.id}: ${upErr.message}`);
    } else {
      console.log(`[ok] updated ${row.id} (${row.url})`);
    }
  }

  console.log(
    `\nDone. ${APPLY ? "APPLIED" : "DRY RUN (use --apply to write)"}\n` +
      `  rows touched: ${rowsChanged}\n` +
      `  competitor entries scored: ${entriesScored}\n` +
      `  already scored (skipped): ${entriesSkipped}\n` +
      `  unreachable (marked crawled=false): ${fetchFailures}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
