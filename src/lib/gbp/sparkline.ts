// ============================================================================
// 12-week rating sparklines for the Reputation listing table.
//
// Pure date/averaging logic (no DB, no request context) so it can be unit
// tested directly — the "use server" actions file can only export async
// functions, so the math lives here and gets imported.
// ============================================================================

export interface SparklinePoint {
  /** "Mon DD" label of the week's Monday. */
  week: string;
  /** Average star rating that week; null = no reviews (a gap, not a 0). */
  avg: number | null;
  /** Reviews that week. */
  count: number;
}

export const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Monday-start week key for a date: "YYYY-MM-DD" of the week's Monday (UTC). */
export function weekKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const day = (d.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

/** The n Monday keys ending with the current week (oldest first). */
export function lastWeekKeys(n: number): string[] {
  const d = new Date();
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day); // this week's Monday
  const keys: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const w = new Date(d);
    w.setUTCDate(d.getUTCDate() - 7 * i);
    keys.push(w.toISOString().slice(0, 10));
  }
  return keys;
}

export const weekLabel = (key: string): string => {
  const d = new Date(key + "T00:00:00Z");
  return `${MONTH_LABELS[d.getUTCMonth()]} ${d.getUTCDate()}`;
};

/**
 * 12-week average-rating series (oldest first) from review rows carrying a
 * star word ("ONE".."FIVE") and a create_time. Weeks with no reviews read as
 * null so the sparkline shows a gap, not a fake flatline. Unknown star words
 * are ignored rather than averaged as 0.
 */
export function buildSparkline(
  rows: { star_rating: string; create_time: string | null }[],
  starsFromWord: (word: string) => number,
  weeks = 12
): SparklinePoint[] {
  const buckets = new Map<string, { sum: number; n: number }>();
  for (const key of lastWeekKeys(weeks)) buckets.set(key, { sum: 0, n: 0 });
  for (const r of rows) {
    if (!r.create_time) continue;
    const b = buckets.get(weekKey(r.create_time));
    if (!b) continue;
    const stars = starsFromWord(r.star_rating);
    if (stars <= 0) continue;
    b.sum += stars;
    b.n += 1;
  }
  return [...buckets.entries()].map(([week, b]) => ({
    week: weekLabel(week),
    avg: b.n > 0 ? Math.round((b.sum / b.n) * 10) / 10 : null,
    count: b.n,
  }));
}
