/**
 * Real site-traffic metrics for the connected GA4 / Search Console sources.
 *
 * GA4 uses the Analytics Data API (runReport, daily granularity) at
 * analyticsdata.googleapis.com; Search Console uses the legacy Webmasters
 * searchAnalytics query at www.googleapis.com. Both return daily rows that
 * the syncSiteMetrics Inngest job upserts into `traffic_snapshots`.
 */

export interface GADailyMetrics {
  date: string; // YYYY-MM-DD
  sessions: number;
  users: number;
  pageviews: number;
  engagementRate: number; // 0-1
}

export interface SCDailyMetrics {
  date: string; // YYYY-MM-DD
  clicks: number;
  impressions: number;
  ctr: number; // 0-1
  position: number;
}

function dateNDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

/** GA4: daily sessions/users/pageviews/engagement via runReport. */
export async function fetchGADailyMetrics(
  accessToken: string,
  propertyId: string,
  days = 30
): Promise<GADailyMetrics[]> {
  const res = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}:runReport`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        dateRanges: [{ startDate: dateNDaysAgo(days), endDate: "today" }],
        dimensions: [{ name: "date" }],
        metrics: [
          { name: "sessions" },
          { name: "totalUsers" },
          { name: "screenPageViews" },
          { name: "engagementRate" },
        ],
        keepEmptyRows: true,
      }),
      signal: AbortSignal.timeout(30_000),
    }
  );
  const text = await res.text().catch(() => "");
  const data = JSON.parse(text || "{}") as {
    rows?: {
      dimensionValues?: { value?: string }[];
      metricValues?: { value?: string }[];
    }[];
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new Error(
      data.error?.message ?? `GA4 runReport failed (${res.status})`
    );
  }
  return (data.rows ?? []).map((row) => {
    const rawDate = row.dimensionValues?.[0]?.value ?? "";
    // GA4 dates are YYYYMMDD when using the "date" dimension.
    const date =
      rawDate.length === 8
        ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`
        : rawDate;
    const num = (i: number) => Number(row.metricValues?.[i]?.value ?? 0);
    return {
      date,
      sessions: num(0),
      users: num(1),
      pageviews: num(2),
      engagementRate: num(3),
    };
  });
}

/** Search Console: daily clicks/impressions/ctr/position. */
export async function fetchSCDailyMetrics(
  accessToken: string,
  siteUrl: string,
  days = 30
): Promise<SCDailyMetrics[]> {
  const encodedSite = encodeURIComponent(siteUrl);
  const res = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodedSite}/searchAnalytics/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        startDate: dateNDaysAgo(days),
        endDate: "today",
        dimensions: ["date"],
        rowLimit: 60,
      }),
      signal: AbortSignal.timeout(30_000),
    }
  );
  const text = await res.text().catch(() => "");
  const data = JSON.parse(text || "{}") as {
    rows?: {
      keys?: string[];
      clicks?: number;
      impressions?: number;
      ctr?: number;
      position?: number;
    }[];
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new Error(
      data.error?.message ?? `Search Console query failed (${res.status})`
    );
  }
  return (data.rows ?? []).map((row) => ({
    date: row.keys?.[0] ?? "",
    clicks: row.clicks ?? 0,
    impressions: row.impressions ?? 0,
    ctr: row.ctr ?? 0,
    position: row.position ?? 0,
  }));
}
