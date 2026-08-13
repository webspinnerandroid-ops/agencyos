/**
 * Keyword ranking matching — turns raw Search Console per-query rows into
 * per-target-keyword measured positions. Used by the dashboard rankings route
 * and the public proposal endpoint so both surface the same numbers.
 */

export interface KeywordRank {
  position: number;
  impressions: number;
  clicks: number;
  query: string;
}

export interface RankingRow {
  query: string;
  position: number | null;
  impressions: number | null;
  clicks: number | null;
}

/**
 * Match each target keyword to the GSC query that exactly equals it, or that
 * contains it (preferring the row with the most impressions). Unmatched
 * keywords are simply absent.
 */
export function matchRankings(
  keywords: string[],
  rows: RankingRow[]
): Record<string, KeywordRank> {
  const rankings: Record<string, KeywordRank> = {};
  for (const kw of keywords) {
    const k = kw.toLowerCase();
    let best: RankingRow | null = null;
    for (const r of rows) {
      const q = (r.query ?? "").toLowerCase();
      if (!q) continue;
      if (q === k || q.includes(k) || k.includes(q)) {
        if (!best || (r.impressions ?? 0) > (best.impressions ?? 0)) {
          best = r;
        }
      }
    }
    if (best && best.position != null) {
      rankings[kw] = {
        position: Math.round(best.position * 10) / 10,
        impressions: best.impressions ?? 0,
        clicks: best.clicks ?? 0,
        query: best.query ?? "",
      };
    }
  }
  return rankings;
}

/** Extract the target keyword strings from a campaign's campaign_json. */
export function targetKeywordsOf(campaignJson: unknown): string[] {
  const cj = (campaignJson ?? {}) as { targetKeywords?: { keyword?: string }[] };
  return (cj.targetKeywords ?? [])
    .map((k) => k.keyword?.trim())
    .filter((k): k is string => Boolean(k));
}
