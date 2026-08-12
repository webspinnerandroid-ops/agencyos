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

interface AnalyticsResponse {
  posts: AnalyticsPost[];
  workspaceId: string | null;
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
            Track post performance across all platforms
            {data?.workspaceId ? " for the current workspace." : " across the whole tenant."}
          </p>
        </div>
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

      {/* Data */}
      {data && (
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