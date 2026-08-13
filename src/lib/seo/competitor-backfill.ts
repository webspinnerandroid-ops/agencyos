// Shared competitor-score backfill.
//
// Scores every competitor already stored in seo_campaigns.competitors_json
// with the same SEO + AEO/GEO engines the crawl uses (scoreCompetitorHtml),
// and merges the scores back in. It never re-crawls the client's own site and
// never touches the campaign itself — only the competitor entries that lack
// scores get fetched and scored (cached per URL, retried once on transient
// errors, polite-spaced).
//
// Used by both scripts/backfill-competitor-scores.ts (one-off, --apply) and
// the scheduled Inngest job scoreCompetitors (runs daily so audits that saved
// competitors while a site was unreachable/blocked get backfilled later).

import { createClient } from "@supabase/supabase-js";
import { scoreCompetitorHtml } from "@/lib/seo/audit-report";
import { fetchCompetitorHtml } from "@/lib/seo/competitor-fetch";
import {
  discoverCompetitors,
  toCompetitorData,
} from "@/lib/seo/competitors";

export interface CompetitorBackfillStats {
  rowsTouched: number;
  scored: number;
  skipped: number;
  unreachable: number;
}

interface CompetitorEntry {
  competitorUrl?: string;
  seoScore?: number | null;
  aeoScore?: number | null;
  geoScore?: number | null;
  competitorWordCount?: number | null;
  crawled?: boolean;
  scoredAt?: string | null;
  [key: string]: unknown;
}

const POLITE_DELAY_MS = 250;

function normalizeUrl(u: string): string {
  let s = (u || "").trim().replace(/\\/g, "/");
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  return s;
}

function isScored(c: CompetitorEntry): boolean {
  // crawled === false means we already tried and the site is dead/blocked —
  // don't re-fetch it every run (each attempt costs a 15s timeout).
  if (c.crawled === false) return true;
  return (
    typeof c.seoScore === "number" ||
    typeof c.aeoScore === "number" ||
    typeof c.geoScore === "number"
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Re-fetch and re-score a single campaign's competitor entries in place
 * (pure — no DB access; the caller owns the fetch + write). Used by the
 * "Re-run audit" action so past campaigns can refresh their benchmark scores
 * without regenerating proposals. Previously-crawled entries are re-fetched
 * so a site that came back online (or a headless fallback that's now
 * enabled) gets a fresh score; dead/blocked entries are marked crawled=false.
 */
export async function rescoreCompetitorEntries(
  entries: CompetitorEntry[]
): Promise<{ entries: CompetitorEntry[]; scored: number; unreachable: number }> {
  const htmlCache = new Map<string, string | null>();
  const fetchHtml = async (url: string): Promise<string | null> => {
    if (htmlCache.has(url)) return htmlCache.get(url) ?? null;
    const html = await fetchCompetitorHtml(url);
    htmlCache.set(url, html);
    return html;
  };

  let scored = 0;
  let unreachable = 0;
  const now = new Date().toISOString();
  for (const c of entries) {
    if (!c || typeof c !== "object") continue;
    const rawUrl = c.competitorUrl;
    if (!rawUrl) continue;
    const url = normalizeUrl(rawUrl);
    const html = await fetchHtml(url);
    if (!html) {
      unreachable++;
      c.seoScore = null;
      c.aeoScore = null;
      c.geoScore = null;
      c.competitorWordCount = null;
      c.crawled = false;
      c.scoredAt = now;
      continue;
    }
    const s = scoreCompetitorHtml(html, url);
    c.seoScore = s.seoScore;
    c.aeoScore = s.aeoScore;
    c.geoScore = s.geoScore;
    c.competitorWordCount = s.wordCount;
    c.crawled = s.crawled;
    c.scoredAt = now;
    scored++;
    await sleep(POLITE_DELAY_MS);
  }
  return { entries, scored, unreachable };
}

/**
 * Newest `scoredAt` across a campaign's competitor entries (or null when no
 * entry has been scored yet). Used for the "last benchmarked" label.
 */
export function latestScoredAt(entries: CompetitorEntry[] | null | undefined): string | null {
  let latest: string | null = null;
  for (const c of entries ?? []) {
    if (c && typeof c.scoredAt === "string" && (!latest || c.scoredAt > latest)) {
      latest = c.scoredAt;
    }
  }
  return latest;
}

function makeClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

export interface BackfillOptions {
  apply?: boolean;
  limit?: number;
  onLog?: (message: string) => void;
}

// ----------------------------------------------------------------------------
// Competitor discovery backfill.
//
// Campaigns generated before competitor discovery was wired (or whose AI
// discovery failed at the time) have an empty competitors_json. This discovers
// real competitors for those campaigns — researching the client's industry +
// location — then scores them with the same SEO + AEO/GEO engines and writes
// them back. It never touches campaigns that already have competitors.
// ----------------------------------------------------------------------------

export interface DiscoveryStats {
  rowsTouched: number;
  discovered: number;
  empty: number;
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return (url || "").replace(/^https?:\/\//, "").split("/")[0] ?? "";
  }
}

/**
 * Discover + score competitors for campaigns whose competitors_json is empty
 * or null. Pure per-row logic lives here so the one-off script, the
 * "Re-run audit" route and the scheduled job can't drift.
 */
export async function discoverAndBackfillCompetitors(
  options: BackfillOptions = {}
): Promise<DiscoveryStats> {
  const { apply = true, limit = 500, onLog } = options;
  const log = onLog ?? (() => {});
  const supabase = makeClient();

  const { data: rows, error } = await supabase
    .from("seo_campaigns")
    .select("id, tenant_id, url, location, audit_json, competitors_json")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Query failed: ${error.message}`);

  const stats: DiscoveryStats = { rowsTouched: 0, discovered: 0, empty: 0 };

  for (const row of rows ?? []) {
    const comps = Array.isArray(row.competitors_json)
      ? row.competitors_json
      : [];
    if (comps.length > 0) continue; // already has competitors — leave untouched

    const audit = (row.audit_json ?? {}) as any;
    const context = {
      url: audit.url ?? row.url ?? "",
      homepageTitle: audit.homepage?.title ?? undefined,
      metaDescription: audit.homepage?.metaDescription ?? undefined,
      overallScore: audit.overallScore ?? undefined,
      location: row.location ?? audit.location ?? null,
    };

    let discovered: string[] = [];
    try {
      discovered = await discoverCompetitors(
        hostnameOf(row.url),
        row.tenant_id,
        context
      );
    } catch (err) {
      log(`[discover] ${row.id} discovery failed: ${(err as Error).message}`);
    }

    if (discovered.length === 0) {
      stats.empty++;
      log(`[empty] ${row.id} (${row.url}) — no competitors discovered`);
      continue;
    }

    // Convert + score with the same engines the crawl uses (SEO + AEO/GEO).
    const entries = await toCompetitorData(discovered.slice(0, 5), context);

    stats.rowsTouched++;
    if (!apply) {
      log(`[dry] would write ${discovered.length} competitors to ${row.id} (${row.url})`);
      continue;
    }
    const { error: upErr } = await supabase
      .from("seo_campaigns")
      .update({ competitors_json: entries })
      .eq("id", row.id);
    if (upErr) {
      log(`[fail] ${row.id}: ${upErr.message}`);
    } else {
      stats.discovered++;
      log(`[ok] ${row.id} (${row.url}) → ${discovered.length} competitors`);
    }
  }

  return stats;
}

export async function backfillCompetitorScores(
  options: BackfillOptions = {}
): Promise<CompetitorBackfillStats> {
  const { apply = true, limit = 500, onLog } = options;
  const log = onLog ?? (() => {});
  const supabase = makeClient();

  const { data: rows, error } = await supabase
    .from("seo_campaigns")
    .select("id, tenant_id, url, competitors_json")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Query failed: ${error.message}`);

  const stats: CompetitorBackfillStats = {
    rowsTouched: 0,
    scored: 0,
    skipped: 0,
    unreachable: 0,
  };
  const htmlCache = new Map<string, string | null>();

  const fetchHtml = async (url: string): Promise<string | null> => {
    if (htmlCache.has(url)) return htmlCache.get(url) ?? null;
    const html = await fetchCompetitorHtml(url);
    htmlCache.set(url, html);
    return html;
  };

  for (const row of rows ?? []) {
    const comps: CompetitorEntry[] = Array.isArray(row.competitors_json)
      ? row.competitors_json
      : [];
    if (comps.length === 0) continue;

    let dirty = false;
    for (const c of comps) {
      if (!c || typeof c !== "object") continue;
      const rawUrl = c.competitorUrl;
      if (!rawUrl) continue;
      if (isScored(c)) {
        stats.skipped++;
        continue;
      }
      const url = normalizeUrl(rawUrl);
      const html = await fetchHtml(url);
      if (!html) {
        stats.unreachable++;
        c.seoScore = null;
        c.aeoScore = null;
        c.geoScore = null;
        c.competitorWordCount = null;
        c.crawled = false;
        c.scoredAt = new Date().toISOString();
        dirty = true;
        continue;
      }
      const s = scoreCompetitorHtml(html, url);
      c.seoScore = s.seoScore;
      c.aeoScore = s.aeoScore;
      c.geoScore = s.geoScore;
      c.competitorWordCount = s.wordCount;
      c.crawled = s.crawled;
      c.scoredAt = new Date().toISOString();
      stats.scored++;
      dirty = true;
      await sleep(POLITE_DELAY_MS);
    }

    if (!dirty) continue;
    stats.rowsTouched++;
    if (!apply) {
      log(`[dry] would update ${row.id} (${row.url})`);
      continue;
    }
    const { error: upErr } = await supabase
      .from("seo_campaigns")
      .update({ competitors_json: comps })
      .eq("id", row.id);
    if (upErr) log(`[fail] ${row.id}: ${upErr.message}`);
    else log(`[ok] updated ${row.id} (${row.url})`);
  }

  return stats;
}
