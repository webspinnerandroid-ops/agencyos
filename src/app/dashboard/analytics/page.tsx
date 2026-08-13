"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  BarChart3,
  TrendingUp,
  FileText,
  ThumbsUp,
  MessageCircle,
  Share2,
  Eye,
  Download,
  ExternalLink,
  Lightbulb,
  Wrench,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { generateAnalyticsPDFBlob } from "@/components/AnalyticsPDF";

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

interface AnalyticsSnapshot {
  id: string;
  platform: string;
  likes: number;
  comments: number;
  shares: number;
  impressions: number;
  reach: number;
  fetched_at: string;
}

interface AnalyticsPost {
  id: string;
  content: string | null;
  scheduled_at: string | null;
  client_id: string | null;
  platforms: string[];
  totalLikes: number;
  totalComments: number;
  totalShares: number;
  totalImpressions: number;
  totalReach: number;
  engagementRate: number;
  links: { platform: string; url: string }[];
  snapshots: AnalyticsSnapshot[];
}

interface AnalyticsSummary {
  totalPosts: number;
  totalLikes: number;
  totalComments: number;
  totalShares: number;
  totalImpressions: number;
  totalEngagement: number;
  avgEngagementRate: number;
  topPost: {
    id: string;
    content: string;
    totalLikes: number;
    totalComments: number;
    totalShares: number;
  } | null;
}

interface Client {
  id: string;
  name: string;
}

interface TrafficRow {
  provider: "google_analytics" | "search_console";
  resource: string;
  metric_date: string;
  sessions: number | null;
  users: number | null;
  pageviews: number | null;
  engagement_rate: number | null;
  clicks: number | null;
  impressions: number | null;
  ctr: number | null;
  position: number | null;
}

interface TrafficSource {
  active: string | null;
  resources: { resource: string; label: string }[];
}

interface AnalyticsResponse {
  posts: AnalyticsPost[];
  workspaceId: string | null;
  traffic: TrafficRow[];
  hasTrafficData: boolean;
  trafficSources: {
    google_analytics: TrafficSource;
    search_console: TrafficSource;
  };
  summary: AnalyticsSummary;
}

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toString();
}

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/**
 * Plain-language, computed insights for a provider's daily traffic rows.
 * Returns two lists: `what` — what the numbers mean plus visible trends and
 * patterns the system is watching; `fix` — concrete, actionable items.
 */
function buildTrafficInsights(
  rows: TrafficRow[],
  isGA: boolean
): { what: string[]; fix: string[] } {
  if (rows.length === 0) return { what: [], fix: [] };
  const sorted = [...rows].sort((a, b) =>
    a.metric_date.localeCompare(b.metric_date)
  );
  const half = Math.floor(sorted.length / 2);
  const sumBy = (fn: (r: TrafficRow) => number) =>
    sorted.reduce((s, r) => s + fn(r), 0);
  const avgBy = (fn: (r: TrafficRow) => number) => sumBy(fn) / sorted.length;
  const what: string[] = [];
  const fix: string[] = [];

  // ---- Data-gap watch: the last row should be close to today (daily sync). ----
  const lastRow = sorted[sorted.length - 1];
  const gapDays = Math.max(
    0,
    Math.floor(
      (Date.now() - new Date(lastRow.metric_date + "T00:00:00").getTime()) /
        (24 * 60 * 60 * 1000)
    )
  );
  if (gapDays >= 5) {
    fix.push(
      `No ${isGA ? "analytics" : "Search Console"} data since ${format(parseISO(lastRow.metric_date), "MMM d, yyyy")} (${gapDays} days). Check that the tracking tag / property is still installed and the daily sync is running.`
    );
  }

  // ---- Day-of-week pattern watch (needs a full week or two). ----
  if (sorted.length >= 10) {
    const byDow = new Map<number, number>();
    const dowCount = new Map<number, number>();
    for (const r of sorted) {
      const dow = new Date(r.metric_date + "T00:00:00").getDay();
      const v = isGA ? r.sessions ?? 0 : r.clicks ?? 0;
      byDow.set(dow, (byDow.get(dow) ?? 0) + v);
      dowCount.set(dow, (dowCount.get(dow) ?? 0) + 1);
    }
    const dowAvg = [...byDow.entries()].map(([d, v]) => ({
      day: d,
      avg: v / (dowCount.get(d) ?? 1),
    }));
    const bestDow = dowAvg.reduce((a, b) => (b.avg > a.avg ? b : a));
    const worstDow = dowAvg.reduce((a, b) => (b.avg < a.avg ? b : a));
    if (bestDow.avg > 0 && bestDow.avg > worstDow.avg * 1.4) {
      what.push(
        `Pattern: ${DAY_NAMES[bestDow.day]} is your strongest day (avg ${Math.round(bestDow.avg)}), while ${DAY_NAMES[worstDow.day]} is quietest (avg ${Math.round(worstDow.avg)}) — schedule ${isGA ? "promotions or pushes" : "high-value content"} on your peak day.`
      );
    }
  }

  // ---- Momentum watch: last 7 days vs the 7 before them. ----
  if (sorted.length >= 14) {
    const metric = (r: TrafficRow) =>
      isGA ? r.sessions ?? 0 : r.clicks ?? 0;
    const prev7 = sorted.slice(-14, -7).reduce((s, r) => s + metric(r), 0);
    const last7 = sorted.slice(-7).reduce((s, r) => s + metric(r), 0);
    if (prev7 > 0 && last7 !== prev7) {
      const pct = Math.round(((last7 - prev7) / prev7) * 100);
      if (Math.abs(pct) >= 10) {
        what.push(
          `Trend: ${isGA ? "traffic" : "clicks"} over the last 7 days are ${pct > 0 ? "up" : "down"} ${Math.abs(pct)}% vs the 7 days before — ${pct > 0 ? "momentum is building" : "a drop worth investigating"}.`
        );
        if (pct < 0) {
          fix.push(
            `${isGA ? "Sessions" : "Clicks"} fell ${Math.abs(pct)}% week over week — review what changed (content cadence, seasonality, algorithm shifts, a broken page).`
          );
        }
      }
    }
  }

  if (isGA) {
    const sessions = sumBy((r) => r.sessions ?? 0);
    const users = sumBy((r) => r.users ?? 0);
    const pageviews = sumBy((r) => r.pageviews ?? 0);
    what.push(
      `Sessions are visits; users are unique visitors. ${sessions.toLocaleString()} sessions from ${users.toLocaleString()} users (${pageviews.toLocaleString()} pageviews) over the period — sessions exceed users when people come back.`
    );
    const best = sorted.reduce((a, b) =>
      (b.sessions ?? 0) > (a.sessions ?? 0) ? b : a
    );
    what.push(
      `Busiest day: ${format(parseISO(best.metric_date), "MMM d, yyyy")} with ${best.sessions ?? 0} sessions.`
    );
    const engagement = avgBy((r) => r.engagement_rate ?? 0);
    what.push(
      `Average engagement rate ${(engagement * 100).toFixed(1)}% — the share of sessions that were engaged (roughly 10+ seconds or a conversion).`
    );
    if (engagement < 0.5) {
      fix.push(
        `Engagement rate is ${(engagement * 100).toFixed(1)}% — under half of sessions stick around. Tighten intros, add internal links, and cut slow-loading pages.`
      );
    }
    if (sessions > 0 && users > 0) {
      const ratio = sessions / users;
      if (ratio < 1.05) {
        fix.push(
          `Almost every session is a new visitor (${ratio.toFixed(2)} sessions per user) — there is no repeat traffic. Add email capture, a newsletter, or returning-visitor content.`
        );
      }
    }
  } else {
    const clicks = sumBy((r) => r.clicks ?? 0);
    const impressions = sumBy((r) => r.impressions ?? 0);
    const position = avgBy((r) => r.position ?? 0);
    what.push(
      `Clicks are visits from Google Search; impressions are how often your pages appeared; CTR = clicks ÷ impressions.`
    );
    what.push(
      `Average position ${position.toFixed(1)} — lower is better (1 = top result, ≈10 is the bottom of page one).`
    );
    const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
    if (impressions > 0) {
      what.push(
        `${clicks.toLocaleString()} clicks from ${impressions.toLocaleString()} impressions (${ctr.toFixed(2)}% CTR).`
      );
    }
    if (impressions > 100 && ctr < 2) {
      fix.push(
        `CTR is ${ctr.toFixed(2)}% (below the ~2% healthy range for this volume). Rewrite titles and meta descriptions with the query intent and add the keyword up front.`
      );
    }
    if (position > 10) {
      fix.push(
        `Average position ${position.toFixed(1)} is beyond page one. Target lower-competition long-tail keywords and build internal links to the pages that matter.`
      );
    } else if (position > 5 && position <= 10) {
      what.push(
        `You average position ${position.toFixed(1)} — solidly on page one, but a jump to the top 5 typically doubles click share.`
      );
    }
    const best = sorted.reduce((a, b) =>
      (b.clicks ?? 0) > (a.clicks ?? 0) ? b : a
    );
    if ((best.clicks ?? 0) > 0) {
      what.push(
        `Best day for clicks: ${format(parseISO(best.metric_date), "MMM d, yyyy")} with ${best.clicks} clicks.`
      );
    }
    const zeroClickDays = sorted.filter((r) => (r.clicks ?? 0) === 0 && (r.impressions ?? 0) > 0).length;
    if (zeroClickDays > 0) {
      fix.push(
        `${zeroClickDays} day(s) had impressions but zero clicks — pages are appearing in results without earning visits. Refresh those titles/snippets.`
      );
    }
  }

  if (half >= 2) {
    const first = sorted.slice(0, half);
    const second = sorted.slice(half);
    const metric = (r: TrafficRow) =>
      isGA ? r.sessions ?? 0 : r.clicks ?? 0;
    const s1 = first.reduce((s, r) => s + metric(r), 0);
    const s2 = second.reduce((s, r) => s + metric(r), 0);
    if (s1 > 0 && s2 !== s1) {
      const pct = Math.round(((s2 - s1) / s1) * 100);
      if (Math.abs(pct) >= 10) {
        what.push(
          `${isGA ? "Sessions" : "Clicks"} in the second half of the period are ${pct > 0 ? "up" : "down"} ${Math.abs(pct)}% vs the first half.`
        );
      }
    }
  }
  return { what, fix };
}

/**
 * Plain-language insights for the Social tab — computed from the enriched
 * post list: platform mix, top content, zero-engagement posts to fix.
 */
function buildSocialInsights(
  posts: AnalyticsPost[]
): { what: string[]; fix: string[] } {
  if (posts.length === 0) return { what: [], fix: [] };
  const what: string[] = [];
  const fix: string[] = [];

  // Platform mix by engagement.
  const byPlatform = new Map<string, number>();
  const platformPosts = new Map<string, number>();
  for (const p of posts) {
    const engaged = p.totalLikes + p.totalComments + p.totalShares;
    const platforms = p.platforms.length > 0 ? p.platforms : ["unknown"];
    for (const pl of platforms) {
      byPlatform.set(pl, (byPlatform.get(pl) ?? 0) + engaged);
      platformPosts.set(pl, (platformPosts.get(pl) ?? 0) + 1);
    }
  }
  const ranked = [...byPlatform.entries()]
    .map(([pl, eng]) => ({
      platform: pl,
      engagement: eng,
      posts: platformPosts.get(pl) ?? 0,
    }))
    .sort((a, b) => b.engagement - a.engagement);
  if (ranked.length >= 2) {
    const top = ranked[0];
    const topShare = Math.round(
      (top.engagement / ranked.reduce((s, r) => s + r.engagement, 0)) * 100
    );
    what.push(
      `${top.platform} drives ${topShare}% of total engagement across ${top.posts} post(s) — your strongest channel right now.`
    );
    if (topShare >= 60) {
      fix.push(
        `Engagement is concentrated on ${top.platform} (${topShare}%). Spread the winning formats there to other channels rather than publishing one-size-fits-all.`
      );
    }
  }

  // Zero-engagement posts — the things-to-fix list.
  const zeroEngagement = posts.filter(
    (p) => p.totalLikes + p.totalComments + p.totalShares === 0
  );
  if (zeroEngagement.length > 0) {
    const share = Math.round((zeroEngagement.length / posts.length) * 100);
    const platforms = new Set(zeroEngagement.flatMap((p) => p.platforms));
    fix.push(
      `${zeroEngagement.length} of ${posts.length} post(s) (${share}%) got zero engagement${platforms.size > 0 ? ` on ${[...platforms].join(", ")}` : ""}. Review their hooks — posts that flatline are usually too promotional or miss the platform's native format.`
    );
  }

  // Top post by engagement.
  const topPost = posts.reduce((a, b) =>
    a.totalLikes + a.totalComments + a.totalShares >
    b.totalLikes + b.totalComments + b.totalShares
      ? a
      : b
  );
  if ((topPost.totalLikes + topPost.totalComments + topPost.totalShares) > 0) {
    what.push(
      `Best performer: "${(topPost.content ?? "Untitled").slice(0, 60)}…" with ${topPost.totalLikes + topPost.totalComments + topPost.totalShares} engagements. Study what it did differently and repeat it.`
    );
  }

  // Comments-vs-likes balance: comments mean conversation, not just a tap.
  const totalEng = posts.reduce(
    (s, p) => s + p.totalLikes + p.totalComments + p.totalShares,
    0
  );
  const totalComments = posts.reduce((s, p) => s + p.totalComments, 0);
  if (totalEng > 0 && totalComments / totalEng < 0.05) {
    fix.push(
      `Comments are under 5% of total engagement — the audience is tapping like but not talking. Ask a direct question in your next post to start a thread.`
    );
  }

  return { what, fix };
}

/**
 * Plain-language insights for the SEO tab — score health, publish pipeline,
 * and the concrete fixes that would move scores into green.
 */
function buildSeoInsights(seoData: any): { what: string[]; fix: string[] } {
  const summary = seoData?.summary;
  if (!summary) return { what: [], fix: [] };
  const what: string[] = [];
  const fix: string[] = [];
  const { bands, avgSeoScore, avgAeoGeoScore, byStatus, publishedOnSite, totalPosts } =
    summary;

  if (totalPosts > 0) {
    what.push(
      `${totalPosts} content piece(s) total; ${publishedOnSite} published to the site. Average SEO score ${avgSeoScore ?? "—"}/100 and AEO/GEO readiness ${avgAeoGeoScore ?? "—"}/100 across scored pieces.`
    );
    const bandTotal = (bands.green ?? 0) + (bands.yellow ?? 0) + (bands.red ?? 0);
    if (bandTotal > 0) {
      what.push(
        `Score spread: ${bands.green ?? 0} green (81+), ${bands.yellow ?? 0} yellow (50–80), ${bands.red ?? 0} red (below 50).`
      );
    }
  }

  if ((bands.red ?? 0) > 0) {
    fix.push(
      `${bands.red} post(s) score below 50 — rewrite them: put the focus keyword in the title, meta, slug and first 10%, expand to 2500+ words, add internal + outbound links and keyword-bearing image alt text.`
    );
  }
  if ((bands.yellow ?? 0) > 0) {
    fix.push(
      `${bands.yellow} post(s) sit in the yellow band — usually small wins close the gap: keyword in the meta/slug, at least one image alt containing the keyword, or breaking up a 120+ word paragraph.`
    );
  }
  if (typeof avgSeoScore === "number" && avgSeoScore < 80 && totalPosts > 0) {
    fix.push(
      `Average SEO score ${avgSeoScore} is below the 80-point publish gate — new content won't auto-publish until it clears the gate. Keep Cheryl's blogs at 1500-2000 words with full keyword coverage (title, meta, slug, first 10%, internal + outbound links, keyword-bearing alt text).`
    );
  }
  const drafts = byStatus?.draft ?? 0;
  if (drafts > 3) {
    fix.push(
      `${drafts} drafts are sitting unpublished — approve, schedule, or cull them so the pipeline stays current.`
    );
  }
  if ((summary.auditsCount ?? 0) > 0 && totalPosts === 0) {
    fix.push(
      `You've run ${summary.auditsCount} audit(s) but generated no content yet — start a campaign from an audit to turn the findings into a content plan.`
    );
  }

  return { what, fix };
}

// ------------------------------------------------------------------
// Page Component
// ------------------------------------------------------------------

export default function AnalyticsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const [startDate, setStartDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState<string>(() => {
    return new Date().toISOString().slice(0, 10);
  });
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  // View mode: social engagement vs SEO monitoring vs site traffic.
  const [tab, setTab] = useState<"social" | "seo" | "traffic">("social");
  const [seoData, setSeoData] = useState<any>(null);
  // Per-provider property picker state for the Traffic tab.
  const [trafficSel, setTrafficSel] = useState<
    Record<"google_analytics" | "search_console", string>
  >({ google_analytics: "", search_console: "" });
  const [syncingProvider, setSyncingProvider] = useState<
    "google_analytics" | "search_console" | null
  >(null);

  // ---- Fetch clients ----
  const fetchClients = useCallback(async () => {
    try {
      const res = await fetch("/api/clients", { credentials: "include" });
      if (res.ok) {
        const json = await res.json();
        setClients(json.clients ?? []);
      }
    } catch {
      // Silently fail
    }
  }, []);

  useEffect(() => {
    fetchClients();
  }, [fetchClients]);

  // ---- Fetch analytics ----
  const fetchAnalytics = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (selectedClientId) {
        params.set("clientId", selectedClientId);
      }
      if (startDate) {
        params.set("startDate", new Date(startDate).toISOString());
      }
      if (endDate) {
        // Include the full end day
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        params.set("endDate", end.toISOString());
      }

      const res = await fetch(`/api/analytics?${params.toString()}`, { credentials: "include" });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error ?? "Failed to fetch analytics");
        setData(null);
        return;
      }

      const json: AnalyticsResponse = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [selectedClientId, startDate, endDate]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  // ---- On-demand sync for a picked GA4 property / SC site ----
  const syncTraffic = useCallback(
    async (
      provider: "google_analytics" | "search_console",
      resource: string
    ) => {
      setSyncingProvider(provider);
      try {
        await fetch("/api/analytics/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider, resource }),
          credentials: "include",
        });
        await fetchAnalytics();
      } catch {
        // fetchAnalytics surfaces load errors in the UI
      } finally {
        setSyncingProvider(null);
      }
    },
    [fetchAnalytics]
  );

  // ---- Fetch SEO analytics (audits, content scores, publish counts) ----
  const fetchSeo = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (selectedClientId) params.set("clientId", selectedClientId);
      const res = await fetch(`/api/analytics/seo?${params.toString()}`, { credentials: "include" });
      if (res.ok) setSeoData(await res.json());
    } catch {
      // ignore — SEO view shows empty state
    }
  }, [selectedClientId]);

  useEffect(() => {
    fetchSeo();
  }, [fetchSeo]);

  // ---- Chart data: likes/comments over time (grouped by date) ----
  const chartData = useMemo(() => {
    if (!data?.posts) return [];

    const byDate = new Map<
      string,
      { date: string; likes: number; comments: number }
    >();

    for (const post of data.posts) {
      if (!post.scheduled_at) continue;
      const dateKey = format(parseISO(post.scheduled_at), "MMM d");
      const existing = byDate.get(dateKey) ?? {
        date: dateKey,
        likes: 0,
        comments: 0,
      };
      existing.likes += post.totalLikes;
      existing.comments += post.totalComments;
      byDate.set(dateKey, existing);
    }

    return Array.from(byDate.values()).sort(
      (a, b) => {
        // Parse back to sort chronologically
        const da = new Date(a.date + " 2026");
        const db = new Date(b.date + " 2026");
        return da.getTime() - db.getTime();
      }
    );
  }, [data]);

  // ---- Export PDF ----
  const handleExportPDF = useCallback(async () => {
    if (!data?.summary || !data?.posts) return;

    setExporting(true);
    try {
      const blob = await generateAnalyticsPDFBlob(data.summary, data.posts);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `analytics-report-${format(new Date(), "yyyy-MM-dd")}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("PDF export failed:", err);
    } finally {
      setExporting(false);
    }
  }, [data]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <BarChart3 className="size-7 text-primary" />
            Analytics
          </h1>
          <p className="text-muted-foreground mt-1">
            {tab === "seo"
              ? "SEO monitoring for client websites — audits, content scores, and publish health."
              : tab === "traffic"
                ? "Real site traffic from your connected Google Analytics 4 and Search Console sources."
                : `Track post performance across all platforms${data?.workspaceId ? " for the current workspace." : " across the whole tenant."}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg border border-border p-1">
            <button
              onClick={() => setTab("social")}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${tab === "social" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              Social
            </button>
            <button
              onClick={() => setTab("seo")}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${tab === "seo" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              SEO
            </button>
            <button
              onClick={() => setTab("traffic")}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${tab === "traffic" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              Traffic
            </button>
          </div>
          {tab === "social" && (
            <Button
              variant="outline"
              disabled={exporting || !data}
              onClick={handleExportPDF}
            >
              {exporting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Exporting…
                </>
              ) : (
                <>
                  <Download className="size-4" />
                  Export Report
                </>
              )}
            </Button>
          )}
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Client</label>
              <select
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={selectedClientId}
                onChange={(e) => setSelectedClientId(e.target.value)}
              >
                <option value="">All Clients</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Start Date</label>
              <input
                type="date"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">End Date</label>
              <input
                type="date"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="mt-4"
            onClick={fetchAnalytics}
            disabled={loading}
          >
            {loading ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                Loading…
              </>
            ) : (
              "Refresh"
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Error */}
      {error && (
        <div className="bg-destructive/10 text-destructive text-sm rounded-md px-4 py-3">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && !data && (
        <div className="flex items-center justify-center py-24 text-muted-foreground">
          <Loader2 className="size-8 animate-spin mr-3" />
          Loading analytics…
        </div>
      )}

      {/* SEO view */}
      {tab === "seo" && (
        <>
          {!seoData ? (
            <div className="flex items-center justify-center py-24 text-muted-foreground">
              <Loader2 className="size-8 animate-spin mr-3" />
              Loading SEO analytics…
            </div>
          ) : (
            <>
              {/* Summary cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                      <FileText className="size-4" />
                      Content Pieces
                    </div>
                    <p className="text-2xl font-bold">{seoData.summary?.totalPosts ?? 0}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                      <TrendingUp className="size-4" />
                      Avg SEO Score
                    </div>
                    <p className="text-2xl font-bold">
                      {seoData.summary?.avgSeoScore != null ? `${seoData.summary.avgSeoScore}/100` : "—"}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                      <Eye className="size-4" />
                      Avg AEO/GEO Readiness
                    </div>
                    <p className="text-2xl font-bold">
                      {seoData.summary?.avgAeoGeoScore != null ? `${seoData.summary.avgAeoGeoScore}/100` : "—"}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                      <Share2 className="size-4" />
                      Published to Website
                    </div>
                    <p className="text-2xl font-bold">{seoData.summary?.publishedOnSite ?? 0}</p>
                  </CardContent>
                </Card>
              </div>

              {/* SEO insights: what it means + things to fix */}
              {(() => {
                const seoInsights = buildSeoInsights(seoData);
                if (seoInsights.what.length === 0 && seoInsights.fix.length === 0)
                  return null;
                return (
                  <div className="grid gap-4 md:grid-cols-2">
                    {seoInsights.what.length > 0 && (
                      <div className="rounded-md bg-muted/50 border border-border p-4 space-y-1">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                          <Lightbulb className="size-3.5" />
                          What this means
                        </p>
                        {seoInsights.what.map((line, i) => (
                          <p key={i} className="text-xs text-muted-foreground">
                            {line}
                          </p>
                        ))}
                      </div>
                    )}
                    {seoInsights.fix.length > 0 && (
                      <div className="rounded-md bg-amber-50/60 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 p-4 space-y-1">
                        <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400 flex items-center gap-1">
                          <Wrench className="size-3.5" />
                          Things to fix
                        </p>
                        {seoInsights.fix.map((line, i) => (
                          <p key={i} className="text-xs text-amber-800 dark:text-amber-300">
                            {line}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Score bands + status breakdown */}
              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>Content Score Health</CardTitle>
                    <CardDescription>
                      Rank Math-style bands: green 81+, yellow 50–80, red below 50.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {(() => {
                      const bands = seoData.summary?.bands ?? {};
                      const total = (bands.green ?? 0) + (bands.yellow ?? 0) + (bands.red ?? 0);
                      const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);
                      return (
                        <div className="space-y-3">
                          {[
                            { label: "Green (81–100)", value: bands.green ?? 0, bar: "bg-green-500" },
                            { label: "Yellow (50–80)", value: bands.yellow ?? 0, bar: "bg-yellow-500" },
                            { label: "Red (below 50)", value: bands.red ?? 0, bar: "bg-red-500" },
                          ].map((b) => (
                            <div key={b.label} className="space-y-1">
                              <div className="flex items-center justify-between text-sm">
                                <span className="text-muted-foreground">{b.label}</span>
                                <span className="font-medium">{b.value}</span>
                              </div>
                              <div className="h-2 rounded-full bg-muted overflow-hidden">
                                <div className={`h-full rounded-full ${b.bar}`} style={{ width: `${pct(b.value)}%` }} />
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Publish Status</CardTitle>
                    <CardDescription>Content pipeline by status.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(seoData.summary?.byStatus ?? {}).map(([status, count]) => (
                        <span key={status} className="text-xs px-2 py-1 rounded-full bg-muted capitalize">
                          {status}: {String(count)}
                        </span>
                      ))}
                      {Object.keys(seoData.summary?.byStatus ?? {}).length === 0 && (
                        <p className="text-sm text-muted-foreground">No content yet.</p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Recent content scores */}
              <Card>
                <CardHeader>
                  <CardTitle>Recent Content Scores</CardTitle>
                  <CardDescription>Latest posts with their SEO and AEO/GEO readiness scores.</CardDescription>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  {(seoData.recent ?? []).length > 0 ? (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                          <th className="py-2 pr-4">Type</th>
                          <th className="py-2 pr-4">Status</th>
                          <th className="py-2 pr-4 text-right">SEO</th>
                          <th className="py-2 pr-4 text-right">AEO/GEO</th>
                          <th className="py-2 text-right">On site</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(seoData.recent ?? []).map((p: any, i: number) => (
                          <tr key={i} className="border-b last:border-0">
                            <td className="py-3 pr-4 capitalize">{p.type}</td>
                            <td className="py-3 pr-4 capitalize">{p.status}</td>
                            <td className="py-3 pr-4 text-right">
                              <span className={p.seo_score != null ? (p.seo_score >= 81 ? "text-green-600 font-medium" : p.seo_score >= 50 ? "text-yellow-600 font-medium" : "text-red-600 font-medium") : "text-muted-foreground"}>
                                {p.seo_score != null ? p.seo_score : "—"}
                              </span>
                            </td>
                            <td className="py-3 pr-4 text-right">
                              {p.aeo_geo_score != null ? p.aeo_geo_score : "—"}
                            </td>
                            <td className="py-3 text-right">
                              {p.cms_published_at ? (
                                <a href={`/site/${p.cms_slug ?? ""}`} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                                  Live ↗
                                </a>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="text-center text-muted-foreground py-20">
                      No content yet — generate your first post to see SEO scores here.
                    </p>
                  )}
                </CardContent>
              </Card>

              {/* Audit history */}
              <Card>
                <CardHeader>
                  <CardTitle>SEO Audits</CardTitle>
                  <CardDescription>Recent site audits (open one to start a campaign from it).</CardDescription>
                </CardHeader>
                <CardContent>
                  {(seoData.audits ?? []).length > 0 ? (
                    <div className="divide-y">
                      {(seoData.audits ?? []).map((a: any) => (
                        <a
                          key={a.id}
                          href={`/dashboard/seo/campaigns?open=${a.id}`}
                          className="flex items-center justify-between py-3 hover:bg-muted/30 transition-colors"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{a.url ?? a.tier_name ?? "Audit"}</p>
                            <p className="text-xs text-muted-foreground">
                              {a.tier_name ?? ""} · {new Date(a.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                            </p>
                          </div>
                          <span className="text-xs px-2 py-0.5 rounded-full capitalize bg-muted">{a.status}</span>
                        </a>
                      ))}
                    </div>
                  ) : (
                    <p className="text-center text-muted-foreground py-10">
                      No audits yet — run an SEO audit to start tracking a website.
                    </p>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </>
      )}

      {/* Traffic view: GA4 + Search Console site metrics */}
      {tab === "traffic" && (
        <>
          {!data ? (
            <div className="flex items-center justify-center py-24 text-muted-foreground">
              <Loader2 className="size-8 animate-spin mr-3" />
              Loading traffic…
            </div>
          ) : (data.traffic ?? []).length === 0 && !data.hasTrafficData ? (
            <Card>
              <CardContent className="py-16 text-center">
                {data.hasTrafficData ? (
                  <>
                    <p className="text-lg font-semibold">
                      No traffic data in this date range
                    </p>
                    <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
                      Your connected sources have synced traffic data, but none falls
                      between the selected dates. Try a wider range.
                    </p>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="mt-4"
                      onClick={() => {
                        const d = new Date();
                        d.setDate(d.getDate() - 90);
                        setStartDate(d.toISOString().slice(0, 10));
                        setEndDate(new Date().toISOString().slice(0, 10));
                      }}
                    >
                      Use last 90 days
                    </Button>
                  </>
                ) : (
                  <>
                    <p className="text-lg font-semibold">No site traffic yet</p>
                    <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
                      Connect Google Analytics 4 and Search Console under{" "}
                      <span className="font-medium">Manage → Connections</span> and pick
                      the property / site to track. The daily sync (Inngest) then fills
                      this view with real numbers.
                    </p>
                    <a
                      href="/dashboard/connections"
                      className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline mt-4"
                    >
                      <BarChart3 className="size-4" /> Open Connections
                    </a>
                  </>
                )}
              </CardContent>
            </Card>
          ) : (
            <>
            {(["google_analytics", "search_console"] as const).map((provider) => {
              const src = data.trafficSources?.[provider] ?? {
                active: null,
                resources: [],
              };
              const picked =
                trafficSel[provider] ||
                src.active ||
                src.resources[0]?.resource ||
                "";
              // When no property list is known yet (migration not applied /
              // cache empty), fall back to every synced row for the provider
              // so the cards still show data instead of a dead empty state.
              const rows = (data.traffic ?? []).filter(
                (r) => r.provider === provider && (!picked || r.resource === picked)
              );
              const isGA = provider === "google_analytics";
              const insights = buildTrafficInsights(rows, isGA);
              const totals = rows.reduce(
                (acc, r) => ({
                  sessions: acc.sessions + (r.sessions ?? 0),
                  users: acc.users + (r.users ?? 0),
                  pageviews: acc.pageviews + (r.pageviews ?? 0),
                  clicks: acc.clicks + (r.clicks ?? 0),
                  impressions: acc.impressions + (r.impressions ?? 0),
                }),
                { sessions: 0, users: 0, pageviews: 0, clicks: 0, impressions: 0 }
              );
              const avgEngagement =
                rows.length > 0
                  ? (rows.reduce((s, r) => s + (r.engagement_rate ?? 0), 0) / rows.length) * 100
                  : 0;
              const avgCtr =
                rows.length > 0
                  ? (rows.reduce((s, r) => s + (r.ctr ?? 0), 0) / rows.length) * 100
                  : 0;
              const avgPosition =
                rows.length > 0
                  ? rows.reduce((s, r) => s + (r.position ?? 0), 0) / rows.length
                  : 0;
              const last14 = rows.slice(-14).reverse();

              return (
                <Card key={provider}>
                  <CardHeader>
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <CardTitle className="flex items-center gap-2">
                        {isGA ? <BarChart3 className="size-5 text-primary" /> : <TrendingUp className="size-5 text-primary" />}
                        {isGA ? "Google Analytics 4" : "Search Console"}
                      </CardTitle>
                      {src.resources.length > 0 && (
                        <select
                          className="rounded-md border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                          value={picked}
                          onChange={(e) =>
                            setTrafficSel((p) => ({
                              ...p,
                              [provider]: e.target.value,
                            }))
                          }
                        >
                          {src.resources.map((o) => (
                            <option key={o.resource} value={o.resource}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                    <CardDescription className="truncate">{picked || "No property selected"}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                  {rows.length === 0 ? (
                    <div className="py-12 text-center">
                      <p className="font-semibold">
                        No data for this property in the selected range
                      </p>
                      <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
                        {picked
                          ? "This property hasn't been synced yet, or its data falls outside the selected dates."
                          : "Connect this source and pick a property to track."}
                      </p>
                      {picked && (
                        <Button
                          variant="secondary"
                          size="sm"
                          className="mt-4"
                          disabled={syncingProvider === provider}
                          onClick={() => syncTraffic(provider, picked)}
                        >
                          {syncingProvider === provider ? (
                            <>
                              <Loader2 className="size-3.5 animate-spin" />
                              Syncing…
                            </>
                          ) : (
                            "Sync this property"
                          )}
                        </Button>
                      )}
                    </div>
                  ) : (
                    <>
                    {/* Summary cards */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {isGA ? (
                        <>
                          <div>
                            <p className="text-xs text-muted-foreground">Sessions</p>
                            <p className="text-xl font-bold">{formatNumber(totals.sessions)}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">Users</p>
                            <p className="text-xl font-bold">{formatNumber(totals.users)}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">Pageviews</p>
                            <p className="text-xl font-bold">{formatNumber(totals.pageviews)}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">Avg engagement</p>
                            <p className="text-xl font-bold">{avgEngagement.toFixed(1)}%</p>
                          </div>
                        </>
                      ) : (
                        <>
                          <div>
                            <p className="text-xs text-muted-foreground">Clicks</p>
                            <p className="text-xl font-bold">{formatNumber(totals.clicks)}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">Impressions</p>
                            <p className="text-xl font-bold">{formatNumber(totals.impressions)}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">Avg CTR</p>
                            <p className="text-xl font-bold">{avgCtr.toFixed(2)}%</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">Avg position</p>
                            <p className="text-xl font-bold">{avgPosition.toFixed(1)}</p>
                          </div>
                        </>
                      )}
                    </div>

                    {/* Daily table (last 14 days) */}
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b text-left text-xs text-muted-foreground">
                            <th className="pb-2 font-medium">Date</th>
                            {isGA ? (
                              <>
                                <th className="pb-2 font-medium text-right">Sessions</th>
                                <th className="pb-2 font-medium text-right">Users</th>
                                <th className="pb-2 font-medium text-right">Pageviews</th>
                                <th className="pb-2 font-medium text-right">Engagement</th>
                              </>
                            ) : (
                              <>
                                <th className="pb-2 font-medium text-right">Clicks</th>
                                <th className="pb-2 font-medium text-right">Impressions</th>
                                <th className="pb-2 font-medium text-right">CTR</th>
                                <th className="pb-2 font-medium text-right">Position</th>
                              </>
                            )}
                          </tr>
                        </thead>
                        <tbody>
                          {last14.map((r) => (
                            <tr key={r.metric_date} className="border-b last:border-0">
                              <td className="py-2 pr-4 whitespace-nowrap text-muted-foreground">
                                {format(parseISO(r.metric_date), "MMM d, yyyy")}
                              </td>
                              {isGA ? (
                                <>
                                  <td className="py-2 pr-4 text-right">{formatNumber(r.sessions ?? 0)}</td>
                                  <td className="py-2 pr-4 text-right">{formatNumber(r.users ?? 0)}</td>
                                  <td className="py-2 pr-4 text-right">{formatNumber(r.pageviews ?? 0)}</td>
                                  <td className="py-2 text-right">{((r.engagement_rate ?? 0) * 100).toFixed(1)}%</td>
                                </>
                              ) : (
                                <>
                                  <td className="py-2 pr-4 text-right">{formatNumber(r.clicks ?? 0)}</td>
                                  <td className="py-2 pr-4 text-right">{formatNumber(r.impressions ?? 0)}</td>
                                  <td className="py-2 pr-4 text-right">{((r.ctr ?? 0) * 100).toFixed(2)}%</td>
                                  <td className="py-2 text-right">{(r.position ?? 0).toFixed(1)}</td>
                                </>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Plain-language insights + things to fix for this report */}
                    {(insights.what.length > 0 || insights.fix.length > 0) && (
                      <div className="space-y-2">
                        {insights.what.length > 0 && (
                          <div className="rounded-md bg-muted/50 border border-border p-3 space-y-1">
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              <Lightbulb className="inline size-3.5 mr-1 -mt-0.5" />
                              What this means
                            </p>
                            {insights.what.map((line, i) => (
                              <p key={i} className="text-xs text-muted-foreground">
                                {line}
                              </p>
                            ))}
                          </div>
                        )}
                        {insights.fix.length > 0 && (
                          <div className="rounded-md bg-amber-50/60 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 p-3 space-y-1">
                            <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                              <Wrench className="inline size-3.5 mr-1 -mt-0.5" />
                              Things to fix
                            </p>
                            {insights.fix.map((line, i) => (
                              <p key={i} className="text-xs text-amber-800 dark:text-amber-300">
                                {line}
                              </p>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    </>
                  )}
                  </CardContent>
                </Card>
              );
            })}
            </>
          )}
        </>
      )}

      {/* Data */}
      {tab === "social" && data && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                  <FileText className="size-4" />
                  Total Posts
                </div>
                <p className="text-2xl font-bold">{data.summary.totalPosts}</p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                  <TrendingUp className="size-4" />
                  Engagement Rate
                </div>
                <p className="text-2xl font-bold">
                  {data.summary.avgEngagementRate}%
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                  <ThumbsUp className="size-4" />
                  Total Likes
                </div>
                <p className="text-2xl font-bold">
                  {formatNumber(data.summary.totalLikes)}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                  <Eye className="size-4" />
                  Impressions
                </div>
                <p className="text-2xl font-bold">
                  {formatNumber(data.summary.totalImpressions)}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                  <MessageCircle className="size-4" />
                  Total Comments
                </div>
                <p className="text-2xl font-bold">
                  {formatNumber(data.summary.totalComments)}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                  <Share2 className="size-4" />
                  Total Shares
                </div>
                <p className="text-2xl font-bold">
                  {formatNumber(data.summary.totalShares)}
                </p>
              </CardContent>
            </Card>

            <Card className="col-span-2">
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                  <TrendingUp className="size-4" />
                  Top Performing Post
                </div>
                {data.summary.topPost ? (
                  <div className="mt-1">
                    <p className="text-sm font-medium line-clamp-1">
                      {data.summary.topPost.content || "No content"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      👍 {data.summary.topPost.totalLikes} · 💬{" "}
                      {data.summary.topPost.totalComments} · 🔄{" "}
                      {data.summary.topPost.totalShares}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No posts yet</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Insights: what the numbers mean + things to fix */}
          {(() => {
            const socialInsights = buildSocialInsights(data.posts);
            if (socialInsights.what.length === 0 && socialInsights.fix.length === 0)
              return null;
            return (
              <div className="grid gap-4 md:grid-cols-2">
                {socialInsights.what.length > 0 && (
                  <div className="rounded-md bg-muted/50 border border-border p-4 space-y-1">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                      <Lightbulb className="size-3.5" />
                      What this means
                    </p>
                    {socialInsights.what.map((line, i) => (
                      <p key={i} className="text-xs text-muted-foreground">
                        {line}
                      </p>
                    ))}
                  </div>
                )}
                {socialInsights.fix.length > 0 && (
                  <div className="rounded-md bg-amber-50/60 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 p-4 space-y-1">
                    <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400 flex items-center gap-1">
                      <Wrench className="size-3.5" />
                      Things to fix
                    </p>
                    {socialInsights.fix.map((line, i) => (
                      <p key={i} className="text-xs text-amber-800 dark:text-amber-300">
                        {line}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Line Chart: Likes/Comments over time */}
          <Card>
            <CardHeader>
              <CardTitle>Likes & Comments Over Time</CardTitle>
              <CardDescription>
                Aggregated daily totals across all published posts.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {chartData.length > 0 ? (
                <div className="h-80 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 12 }}
                        interval="preserveStartEnd"
                      />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey="likes"
                        stroke="#3b82f6"
                        strokeWidth={2}
                        dot={{ r: 3 }}
                        name="Likes"
                      />
                      <Line
                        type="monotone"
                        dataKey="comments"
                        stroke="#f59e0b"
                        strokeWidth={2}
                        dot={{ r: 3 }}
                        name="Comments"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="text-center text-muted-foreground py-20">
                  No data for the selected period.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Post Table */}
          <Card>
            <CardHeader>
              <CardTitle>Post Performance</CardTitle>
              <CardDescription>
                Individual post metrics for the selected period.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {data.posts.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-muted-foreground">
                        <th className="pb-3 font-medium">Content</th>
                        <th className="pb-3 font-medium">Post</th>
                        <th className="pb-3 font-medium">Date</th>
                        <th className="pb-3 font-medium text-right">Likes</th>
                        <th className="pb-3 font-medium text-right">
                          Comments
                        </th>
                        <th className="pb-3 font-medium text-right">Shares</th>
                        <th className="pb-3 font-medium text-right">
                          Impressions
                        </th>
                        <th className="pb-3 font-medium text-right">
                          Engagement
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.posts.map((post) => (
                        <tr
                          key={post.id}
                          className="border-b last:border-0 hover:bg-muted/30 transition-colors"
                        >
                          <td className="py-3 pr-4 max-w-[200px] truncate">
                            {post.content?.slice(0, 80) ?? "—"}
                          </td>
                          <td className="py-3 pr-4 whitespace-nowrap">
                            {post.platforms && post.platforms.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {post.platforms.map((platform) => {
                                  const link = (post.links ?? []).find(
                                    (l) => l.platform === platform
                                  );
                                  const label = (
                                    <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full bg-primary/10 capitalize">
                                      {platform}
                                      {link && <ExternalLink className="size-2.5" />}
                                    </span>
                                  );
                                  return link ? (
                                    <a
                                      key={platform}
                                      href={link.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="hover:bg-primary/20"
                                    >
                                      {label}
                                    </a>
                                  ) : (
                                    <span key={platform}>{label}</span>
                                  );
                                })}
                              </div>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="py-3 pr-4 whitespace-nowrap text-muted-foreground">
                            {post.scheduled_at
                              ? format(
                                  parseISO(post.scheduled_at),
                                  "MMM d, yyyy"
                                )
                              : "—"}
                          </td>
                          <td className="py-3 pr-4 text-right">
                            {formatNumber(post.totalLikes)}
                          </td>
                          <td className="py-3 pr-4 text-right">
                            {formatNumber(post.totalComments)}
                          </td>
                          <td className="py-3 pr-4 text-right">
                            {formatNumber(post.totalShares)}
                          </td>
                          <td className="py-3 pr-4 text-right text-muted-foreground">
                            {formatNumber(post.totalImpressions)}
                          </td>
                          <td className="py-3 text-right">
                            <span
                              className={
                                post.engagementRate >= 5
                                  ? "text-green-600 font-medium"
                                  : post.engagementRate >= 2
                                  ? "text-yellow-600 font-medium"
                                  : "text-muted-foreground"
                              }
                            >
                              {post.engagementRate}%
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-center text-muted-foreground py-20">
                  No posts found for the selected filters.
                </p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}