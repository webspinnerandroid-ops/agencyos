"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  RefreshCw,
  Search,
  Globe,
  FileText,
  TrendingUp,
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  LineChart as LineChartIcon,
  MousePointerClick,
  Eye,
  Gauge,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { ScoreBreakdown } from "@/components/seo/score-breakdown";

interface AuditRun {
  id: string;
  mode: "url" | "text";
  url: string | null;
  title: string;
  keyword: string;
  seo_score: number | null;
  aeo_score: number | null;
  geo_score: number | null;
  word_count: number;
  issues: number;
  checks_json: { seo: EngineCheck[]; aeoGeo: EngineCheck[] } | null;
  fetched: boolean | null;
  fetch_error: string | null;
  created_at: string;
}

interface EngineCheck {
  id: string;
  label: string;
  category?: string;
  pillar?: string;
  maxPoints: number;
  earned: number;
  passed: boolean;
  detail: string;
}

interface TrafficRow {
  id: string;
  provider: "google_analytics" | "search_console";
  resource: string;
  metric_date: string;
  sessions?: number | null;
  users?: number | null;
  pageviews?: number | null;
  clicks?: number | null;
  impressions?: number | null;
  ctr?: number | null;
  position?: number | null;
}

interface SiteHistory {
  audits: AuditRun[];
  traffic: { googleAnalytics: TrafficRow[]; searchConsole: TrafficRow[] };
}

interface MonitoredSite {
  key: string;
  mode: "url" | "text";
  url: string | null;
  title: string;
  keyword: string;
  seoScore: number | null;
  aeoScore: number | null;
  geoScore: number | null;
  issues: number;
  fetched: boolean | null;
  fetchError: string | null;
  lastAuditedAt: string;
  auditCount: number;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function scoreTone(v: number | null): string {
  if (v == null) return "text-muted-foreground";
  return v >= 80 ? "text-green-600 dark:text-green-400" : v >= 50 ? "text-yellow-600 dark:text-yellow-400" : "text-red-600 dark:text-red-400";
}

function fmtNumber(v: number | null | undefined): string {
  return v == null ? "—" : v.toLocaleString();
}

function fmtPct(v: number | null | undefined): string {
  return v == null ? "—" : `${(v * 100).toFixed(1)}%`;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function deltaLabel(prev: number | null | undefined, curr: number | null | undefined): { text: string; cls: string } | null {
  if (prev == null || curr == null) return null;
  const d = curr - prev;
  if (d === 0) return { text: "no change", cls: "text-muted-foreground" };
  return {
    text: `${d > 0 ? "▲" : "▼"} ${Math.abs(d)} vs previous`,
    cls: d > 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400",
  };
}

export default function SeoSitesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeUrl = searchParams.get("url") ?? "";

  const [sites, setSites] = useState<MonitoredSite[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reauditing, setReauditing] = useState<string | null>(null);

  // Site detail state (when ?url= is present).
  const [history, setHistory] = useState<SiteHistory | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const loadDetail = useCallback(async (key: string) => {
    setLoadingHistory(true);
    setError(null);
    try {
      const res = await fetch(`/api/seo/audits?url=${encodeURIComponent(key)}`, {
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to load site history.");
        return;
      }
      setHistory(data);
    } catch {
      setError("Network error while loading site history.");
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    if (activeUrl) loadDetail(activeUrl);
  }, [activeUrl, loadDetail]);

  const load = useCallback(async (query: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/seo/audits${query ? `?search=${encodeURIComponent(query)}` : ""}`,
        { credentials: "include" }
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to load monitored sites.");
        return;
      }
      setSites(data.sites ?? []);
    } catch {
      setError("Network error while loading monitored sites.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load("");
  }, [load]);

  // Debounce search.
  useEffect(() => {
    const t = setTimeout(() => load(search), 350);
    return () => clearTimeout(t);
  }, [search, load]);

  const reAudit = async (site: MonitoredSite) => {
    if (site.mode !== "url" || !site.url) return;
    setReauditing(site.key);
    setError(null);
    try {
      const res = await fetch("/api/seo/audits", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: site.url }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Re-audit failed.");
        return;
      }
      await load(search);
      if (activeUrl) await loadDetail(activeUrl);
    } catch {
      setError("Network error while re-auditing.");
    } finally {
      setReauditing(null);
    }
  };

  const scored = sites.filter((s) => s.seoScore != null);
  const avgScore = scored.length
    ? Math.round(scored.reduce((sum, s) => sum + (s.seoScore ?? 0), 0) / scored.length)
    : null;
  const totalIssues = sites.reduce((sum, s) => sum + s.issues, 0);
  const totalAudits = sites.reduce((sum, s) => sum + s.auditCount, 0);

  // ------------------------------------------------------------------
  // Site detail view (when ?url= is set)
  // ------------------------------------------------------------------
  const latest = history?.audits?.[0];
  const prev = history?.audits?.[1];

  const chartData = useMemo(
    () =>
      (history?.audits ?? [])
        .slice()
        .reverse()
        .map((a) => ({
          date: fmtDate(a.created_at),
          SEO: a.seo_score,
          AEO: a.aeo_score,
          GEO: a.geo_score,
        })),
    [history]
  );

  if (activeUrl) {
    const label = latest?.url
      ? latest.url.replace(/^https?:\/\//, "").replace(/\/$/, "")
      : latest?.title || activeUrl;

    return (
      <div className="p-6 max-w-6xl mx-auto space-y-8">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => router.push("/dashboard/seo/sites")}
              className="text-muted-foreground hover:text-foreground shrink-0"
              title="Back to monitored sites"
            >
              <ArrowLeft className="size-5" />
            </button>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold tracking-tight truncate">{label}</h1>
              <p className="text-muted-foreground text-sm">
                {latest?.mode === "url" ? "Monitored website" : "Saved content audit"}
                {latest?.keyword ? ` · scored vs “${latest.keyword}”` : ""}
                {latest?.word_count ? ` · ${latest.word_count.toLocaleString()} words` : ""}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {latest?.mode === "url" && (
              <Button
                onClick={() => latest && reAudit({ ...latest as unknown as MonitoredSite, key: activeUrl })}
                disabled={reauditing === activeUrl}
              >
                {reauditing === activeUrl ? (
                  <Loader2 className="size-4 animate-spin mr-2" />
                ) : (
                  <RefreshCw className="size-4 mr-2" />
                )}
                Re-run Audit
              </Button>
            )}
            <a href="/dashboard/seo/analyzer">
              <Button variant="outline">New Audit</Button>
            </a>
          </div>
        </div>

        {loadingHistory ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : !latest ? (
          <Card className="p-12 text-center">
            <p className="text-muted-foreground">No audits found for this site.</p>
          </Card>
        ) : (
          <>
            {latest.fetch_error && (
              <div className="p-3 rounded-md bg-amber-50 dark:bg-amber-950 border border-amber-300 dark:border-amber-800 text-sm text-amber-700 dark:text-amber-300">
                {latest.fetch_error}
              </div>
            )}

            {/* Current scores */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: "SEO", v: latest.seo_score },
                { label: "AEO", v: latest.aeo_score },
                { label: "GEO", v: latest.geo_score },
              ].map((s) => {
                const dl = deltaLabel(
                  s.label === "SEO" ? prev?.seo_score : s.label === "AEO" ? prev?.aeo_score : prev?.geo_score,
                  s.v
                );
                return (
                  <Card key={s.label} className="p-4">
                    <div className="text-xs text-muted-foreground uppercase tracking-wide">{s.label}</div>
                    <div className={`text-3xl font-bold mt-1 ${scoreTone(s.v)}`}>{s.v ?? "—"}</div>
                    {dl && <div className={`text-[11px] mt-1 ${dl.cls}`}>{dl.text}</div>}
                  </Card>
                );
              })}
              <Card className="p-4">
                <div className="text-xs text-muted-foreground uppercase tracking-wide">Issues</div>
                <div className={`text-3xl font-bold mt-1 ${latest.issues > 0 ? "text-amber-600 dark:text-amber-400" : "text-green-600 dark:text-green-400"}`}>
                  {latest.issues}
                </div>
                <div className="text-[11px] text-muted-foreground mt-1">failed checks</div>
              </Card>
            </div>

            {/* Score history chart */}
            {chartData.length >= 2 && (
              <Card className="p-6">
                <div className="flex items-center gap-2 mb-4">
                  <LineChartIcon className="size-4 text-primary" />
                  <h2 className="text-lg font-semibold">Score history</h2>
                  <span className="text-xs text-muted-foreground">
                    {history?.audits.length} audit(s) · compare results after each re-run
                  </span>
                </div>
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={chartData} margin={{ top: 5, right: 10, left: -15, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Line type="monotone" dataKey="SEO" stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="AEO" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="GEO" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </Card>
            )}

            {/* Full breakdown */}
            <Card className="p-6">
              <div className="flex items-center justify-between gap-2 mb-4">
                <div>
                  <h2 className="text-lg font-semibold">How the score is made</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Latest run · {fmtDate(latest.created_at)}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <ScoreBreakdown
                  title="SEO"
                  score={latest.seo_score}
                  seoChecks={latest.checks_json?.seo ?? []}
                  defaultCollapsed={false}
                />
                <ScoreBreakdown
                  title="AEO"
                  score={latest.aeo_score}
                  aeoGeoChecks={latest.checks_json?.aeoGeo ?? []}
                />
                <ScoreBreakdown
                  title="GEO"
                  score={latest.geo_score}
                  aeoGeoChecks={latest.checks_json?.aeoGeo ?? []}
                />
              </div>
            </Card>

            {/* GSC + GA4 traffic (when connected) */}
            {(history?.traffic?.searchConsole.length || history?.traffic?.googleAnalytics.length) ? (
              <Card className="p-6">
                <div className="flex items-center gap-2 mb-4">
                  <BarChart3 className="size-4 text-primary" />
                  <h2 className="text-lg font-semibold">Live traffic (Google data)</h2>
                  <span className="text-xs text-muted-foreground">
                    from your connected Search Console & Analytics
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {history.traffic.searchConsole.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                        <MousePointerClick className="size-4 text-primary" /> Search Console
                      </h3>
                      <div className="space-y-1.5 text-sm">
                        {history.traffic.searchConsole.slice(0, 5).map((r) => (
                          <div key={r.id} className="flex items-center justify-between gap-2 border-b pb-1.5 last:border-0">
                            <span className="text-muted-foreground">{fmtDate(r.metric_date)}</span>
                            <span className="flex items-center gap-3">
                              <span className="inline-flex items-center gap-1"><Eye className="size-3.5 text-muted-foreground" /> {fmtNumber(r.clicks)}</span>
                              <span className="inline-flex items-center gap-1"><Gauge className="size-3.5 text-muted-foreground" /> {fmtNumber(r.impressions)}</span>
                              <span>CTR {fmtPct(r.ctr)}</span>
                              <span>pos {r.position ?? "—"}</span>
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {history.traffic.googleAnalytics.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                        <LineChartIcon className="size-4 text-primary" /> Google Analytics 4
                      </h3>
                      <div className="space-y-1.5 text-sm">
                        {history.traffic.googleAnalytics.slice(0, 5).map((r) => (
                          <div key={r.id} className="flex items-center justify-between gap-2 border-b pb-1.5 last:border-0">
                            <span className="text-muted-foreground">{fmtDate(r.metric_date)}</span>
                            <span className="flex items-center gap-3">
                              <span>users {fmtNumber(r.users)}</span>
                              <span>sessions {fmtNumber(r.sessions)}</span>
                              <span>views {fmtNumber(r.pageviews)}</span>
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground mt-3 italic">
                  Traffic rows come from your daily Google sync. To see them here,
                  connect Search Console / Analytics and pick this site's property.
                </p>
              </Card>
            ) : (
              <Card className="p-6">
                <div className="flex items-center gap-2 mb-2">
                  <BarChart3 className="size-4 text-primary" />
                  <h2 className="text-lg font-semibold">Live traffic (Google data)</h2>
                </div>
                <p className="text-sm text-muted-foreground">
                  Connect Google Analytics 4 and Search Console to see this site's real
                  traffic, clicks and positions alongside its audit scores.
                </p>
                <a href="/dashboard/connections">
                  <Button variant="outline" size="sm" className="mt-3">
                    Manage connections
                  </Button>
                </a>
              </Card>
            )}

            {/* Previous runs table */}
            {history && history.audits.length > 1 && (
              <Card className="p-6">
                <h2 className="text-lg font-semibold mb-4">Previous audits</h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="py-2 pr-4">Date</th>
                        <th className="py-2 pr-4 text-right">SEO</th>
                        <th className="py-2 pr-4 text-right">AEO</th>
                        <th className="py-2 pr-4 text-right">GEO</th>
                        <th className="py-2 pr-4 text-right">Issues</th>
                        <th className="py-2 text-right">Words</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.audits.map((a) => (
                        <tr key={a.id} className="border-b last:border-0">
                          <td className="py-2 pr-4 text-muted-foreground">{fmtDate(a.created_at)}</td>
                          <td className={`py-2 pr-4 text-right font-bold ${scoreTone(a.seo_score)}`}>{a.seo_score ?? "—"}</td>
                          <td className={`py-2 pr-4 text-right font-bold ${scoreTone(a.aeo_score)}`}>{a.aeo_score ?? "—"}</td>
                          <td className={`py-2 pr-4 text-right font-bold ${scoreTone(a.geo_score)}`}>{a.geo_score ?? "—"}</td>
                          <td className="py-2 pr-4 text-right text-muted-foreground">{a.issues}</td>
                          <td className="py-2 text-right text-muted-foreground">{a.word_count.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Monitored Sites</h1>
        <p className="text-muted-foreground mt-1">
          Every URL or text content you audit is saved here with full SEO / AEO /
          GEO scores. Re-run after edits to see how your changes moved the score,
          and open any site for its full breakdown and history.
        </p>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="text-xs text-muted-foreground uppercase tracking-wide">Sites monitored</div>
          <div className="text-2xl font-bold mt-1">{sites.length}</div>
          <div className="text-[11px] text-muted-foreground">{totalAudits} audits all time</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground uppercase tracking-wide">Avg. SEO score</div>
          <div className={`text-2xl font-bold mt-1 ${scoreTone(avgScore)}`}>
            {avgScore ?? "—"}
          </div>
          <div className="text-[11px] text-muted-foreground">across scored sites</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground uppercase tracking-wide">Active issues</div>
          <div className="text-2xl font-bold mt-1">{totalIssues}</div>
          <div className="text-[11px] text-muted-foreground">failed checks to fix</div>
        </Card>
        <Card className="p-4 flex flex-col justify-center">
          <a href="/dashboard/seo/analyzer">
            <Button className="w-full">+ New Audit</Button>
          </a>
          <p className="text-[11px] text-muted-foreground mt-2 text-center">
            Analyze a URL or paste content
          </p>
        </Card>
      </div>

      {/* Search */}
      <Card className="p-4">
        <div className="flex items-center gap-3">
          <Search className="size-4 text-muted-foreground shrink-0" />
          <Input
            placeholder="Search websites…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1"
          />
        </div>
      </Card>

      {error && (
        <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : sites.length === 0 ? (
        <Card className="p-12 text-center">
          <Globe className="size-8 text-muted-foreground mx-auto mb-3" />
          <h2 className="text-lg font-semibold">No monitored sites yet</h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
            Run an audit on a URL or pasted content — it will show up here with
            its full score breakdown, and you can re-run it anytime to track
            your improvements over time.
          </p>
          <a href="/dashboard/seo/analyzer" className="inline-block mt-4">
            <Button>Run your first audit</Button>
          </a>
        </Card>
      ) : (
        <Card className="p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground bg-muted/40">
                  <th className="py-3 pl-4 pr-4 font-medium">Website</th>
                  <th className="py-3 pr-4 font-medium text-right">Score</th>
                  <th className="py-3 pr-4 font-medium text-right">SEO</th>
                  <th className="py-3 pr-4 font-medium text-right">AEO</th>
                  <th className="py-3 pr-4 font-medium text-right">GEO</th>
                  <th className="py-3 pr-4 font-medium text-right">Issues</th>
                  <th className="py-3 pr-4 font-medium text-right">Audits</th>
                  <th className="py-3 pr-4 font-medium text-right">Last audited</th>
                  <th className="py-3 pr-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sites.map((site) => {
                  const label = site.url
                    ? site.url.replace(/^https?:\/\//, "").replace(/\/$/, "")
                    : site.title || "Pasted content";
                  const score =
                    site.seoScore != null &&
                    site.aeoScore != null &&
                    site.geoScore != null
                      ? Math.round((site.seoScore + site.aeoScore + site.geoScore) / 3)
                      : site.seoScore;
                  return (
                    <tr key={site.key} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="py-3 pl-4 pr-4">
                        <a href={`/dashboard/seo/sites?url=${encodeURIComponent(site.key)}`} className="font-medium hover:text-primary inline-flex items-center gap-1.5">
                          {site.mode === "url" ? (
                            <Globe className="size-3.5 text-muted-foreground shrink-0" />
                          ) : (
                            <FileText className="size-3.5 text-muted-foreground shrink-0" />
                          )}
                          <span className="break-all">{label}</span>
                        </a>
                        <span className="block text-[11px] text-muted-foreground mt-0.5">
                          vs “{site.keyword || "—"}”
                          {site.fetchError ? (
                            <span className="text-amber-600 dark:text-amber-500 ml-2 italic">
                              {site.fetchError.slice(0, 80)}
                            </span>
                          ) : null}
                        </span>
                      </td>
                      <td className={`py-3 pr-4 text-right font-bold ${scoreTone(score)}`}>
                        {score ?? "—"}
                      </td>
                      <td className={`py-3 pr-4 text-right font-bold ${scoreTone(site.seoScore)}`}>
                        {site.seoScore ?? "—"}
                      </td>
                      <td className={`py-3 pr-4 text-right font-bold ${scoreTone(site.aeoScore)}`}>
                        {site.aeoScore ?? "—"}
                      </td>
                      <td className={`py-3 pr-4 text-right font-bold ${scoreTone(site.geoScore)}`}>
                        {site.geoScore ?? "—"}
                      </td>
                      <td className="py-3 pr-4 text-right">
                        {site.issues > 0 ? (
                          <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-500 font-medium">
                            <AlertTriangle className="size-3.5" /> {site.issues}
                          </span>
                        ) : (
                          <span className="text-green-600 dark:text-green-400">0</span>
                        )}
                      </td>
                      <td className="py-3 pr-4 text-right text-muted-foreground">
                        {site.auditCount}
                      </td>
                      <td className="py-3 pr-4 text-right text-muted-foreground whitespace-nowrap">
                        {timeAgo(site.lastAuditedAt)}
                      </td>
                      <td className="py-3 pr-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <a href={`/dashboard/seo/sites?url=${encodeURIComponent(site.key)}`}>
                            <Button variant="outline" size="sm">Open</Button>
                          </a>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={reauditing === site.key}
                            onClick={() => reAudit(site)}
                            title="Re-run the audit now to see fresh results after edits"
                          >
                            {reauditing === site.key ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                              <RefreshCw className="size-3.5" />
                            )}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <TrendingUp className="size-3.5" />
        Open a site to see its score history and compare previous vs recent results.
      </div>
    </div>
  );
}
