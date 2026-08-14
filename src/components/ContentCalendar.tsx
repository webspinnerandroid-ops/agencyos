"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  format,
  isSameDay,
  isSameMonth,
  addMonths,
  subMonths,
  parseISO,
} from "date-fns";
import {
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  BarChart3,
  TrendingUp,
  ThumbsUp,
  MessageCircle,
  Share2,
  Eye,
  Loader2,
  RefreshCw,
  RotateCcw,
  AlertTriangle,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from "recharts";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import PostContent from "@/components/BlogContent";
import ScoreBadge from "@/components/ScoreBadge";

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

interface SocialAccount {
  id: string;
  platform: string;
}

interface PostPlatform {
  id: string;
  social_account_id: string | null;
  social_accounts: SocialAccount | null;
}

export interface CalendarPost {
  id: string;
  content: string | null;
  media_urls: string[];
  scheduled_at: string | null;
  status: PostStatus;
  created_by: string | null;
  approved_by: string | null;
  ai_generated: boolean;
  tier_level: number | null;
  client_id: string | null;
  revision_reason?: string | null;
  seo_score?: number | null;
  seo_checks?: unknown;
  post_platforms: PostPlatform[] | null;
}

export type PostStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "revision_requested"
  | "scheduled"
  | "published"
  | "failed";

/** A proposed piece from a campaign plan (Malory's mapped-out campaign). */
export interface ProposedItem {
  id: string;
  date: string; // yyyy-MM-dd
  title: string;
  kind: "blog" | "social" | "website" | "research";
  planId: string;
  planTitle: string;
  platform?: string | null;
  owner?: string | null;
  keywords?: string[] | null;
  internalLink?: string | null;
  externalLinks?: string[] | null;
}

interface Client {
  id: string;
  name: string;
}

// ------------------------------------------------------------------
// Constants
// ------------------------------------------------------------------

const STATUS_CONFIG: Record<
  PostStatus,
  { label: string; className: string }
> = {
  draft: {
    label: "Draft",
    className: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  },
  pending_approval: {
    label: "Pending Approval",
    className:
      "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  },
  approved: {
    label: "Approved",
    className:
      "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  },
  revision_requested: {
    label: "Revision Requested",
    className: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  },
  scheduled: {
    label: "Scheduled",
    className:
      "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  },
  published: {
    label: "Published",
    className:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  },
  failed: {
    label: "Failed",
    className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  },
};

const ALL_STATUSES: PostStatus[] = [
  "draft",
  "pending_approval",
  "approved",
  "revision_requested",
  "scheduled",
  "published",
  "failed",
];

const PLATFORM_ICONS: Record<string, string> = {
  instagram: "📷",
  twitter: "🐦",
  linkedin: "💼",
  facebook: "📘",
  tiktok: "🎵",
  threads: "🧵",
  youtube: "▶️",
  pinterest: "📌",
};

/** Employee key → display name for the owner chip on proposed items. */
const OWNER_NAMES: Record<string, string> = {
  penny: "Cheryl",
  eva: "Woodhouse",
  sonny: "Pam",
  stan: "Barry",
  rachel: "Brett",
  scout: "AK",
  dev: "Ray",
  gauge: "Sterling",
  nina: "Malory",
  juno: "Lana",
  linda: "Cyril",
};

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

interface AnalyticsSnapshot {
  id: string;
  post_id: string;
  platform: string;
  likes: number;
  comments: number;
  shares: number;
  impressions: number;
  reach: number;
  fetched_at: string;
}

/** A blog whose body never generated (empty body / legacy placeholder). */
function isBrokenBlogPost(post: CalendarPost): boolean {
  if (!post.content) return false;
  let parsed: Record<string, unknown> | null = null;
  if (typeof post.content === "string") {
    try {
      parsed = JSON.parse(post.content);
    } catch {
      return false;
    }
  } else if (typeof post.content === "object") {
    parsed = post.content as Record<string, unknown>;
  }
  if (!parsed || parsed.type !== "blog") return false;
  const body = parsed.body;
  return typeof body !== "string" || body.trim().length === 0;
}

/** True when the post is a generated blog (rewriteable via Cheryl's pipeline). */
function isBlogPost(post: CalendarPost): boolean {
  if (!post.content) return false;
  let parsed: Record<string, unknown> | null = null;
  if (typeof post.content === "string") {
    try {
      parsed = JSON.parse(post.content);
    } catch {
      return false;
    }
  } else if (typeof post.content === "object") {
    parsed = post.content as Record<string, unknown>;
  }
  return parsed?.type === "blog";
}

function getPlatformsForPost(post: CalendarPost): string[] {
  if (!post.post_platforms || post.post_platforms.length === 0) return [];
  const platforms: string[] = [];
  for (const pp of post.post_platforms) {
    if (pp.social_accounts?.platform) {
      platforms.push(pp.social_accounts.platform);
    }
  }
  return [...new Set(platforms)];
}

function excerptFromContent(content: string | null | Record<string, unknown>, maxLen = 60): string {
  // Blog posts store content as an object ({ type: "blog", title, body, ... }),
  // social posts as plain text. Normalize to a string first.
  let text = typeof content === "string" ? content : "";
  if (!text && content && typeof content === "object") {
    const c = content as Record<string, any>;
    text = typeof c.title === "string" ? c.title : "";
    if (!text && typeof c.body === "string") text = c.body;
    if (!text && typeof c.caption === "string") text = c.caption;
    if (!text) {
      try { text = JSON.stringify(c); } catch { text = ""; }
    }
  }
  if (!text || text.length === 0) return "No content";
  const plain = text.replace(/[#*_`~\[\]]/g, "").trim();
  if (plain.length <= maxLen) return plain;
  return plain.slice(0, maxLen) + "…";
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toString();
}

// ------------------------------------------------------------------
// Component
// ------------------------------------------------------------------

interface ContentCalendarProps {
  posts: CalendarPost[];
  proposedItems?: ProposedItem[];
  clients: Client[];
  selectedClientId: string | null;
  selectedStatuses: PostStatus[];
  onClientChange: (clientId: string | null) => void;
  onStatusesChange: (statuses: PostStatus[]) => void;
  onPostUpdate: (
    postId: string,
    data: Partial<Pick<CalendarPost, "status" | "revision_reason">>
  ) => Promise<void>;
  onApproveProposed: (item: ProposedItem, mediaKind: "image" | "video") => Promise<void>;
  onRefresh: () => void;
}

export default function ContentCalendar({
  posts,
  proposedItems = [],
  clients,
  selectedClientId,
  selectedStatuses,
  onClientChange,
  onStatusesChange,
  onPostUpdate,
  onApproveProposed,
  onRefresh,
}: ContentCalendarProps) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedPost, setSelectedPost] = useState<CalendarPost | null>(null);
  const [selectedProposed, setSelectedProposed] = useState<ProposedItem | null>(null);
  const [approving, setApproving] = useState(false);
  const [mediaKind, setMediaKind] = useState<"image" | "video">("image");
  const [revisionPost, setRevisionPost] = useState<CalendarPost | null>(null);
  const [revisionReason, setRevisionReason] = useState("");
  const [revisionSaving, setRevisionSaving] = useState(false);
  const [revisionTarget, setRevisionTarget] = useState<"text" | "images" | "both">("text");
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [postAttempts, setPostAttempts] = useState<
    { id: string; platform: string; success: boolean; error_message: string | null; attempt_at: string }[]
  >([]);
  const [attemptsLoading, setAttemptsLoading] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [rewritePost, setRewritePost] = useState<CalendarPost | null>(null);
  const [rewriteFeedback, setRewriteFeedback] = useState("");
  const [retrying, setRetrying] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);

  // Retry a failed publish — targets the platform of the last failed attempt
  // so the user can see the exact error and try again without leaving the page.
  const retryPublish = useCallback(async () => {
    if (!selectedPost || retrying) return;
    setRetrying(true);
    setPublishError(null);
    try {
      const lastFailed = postAttempts.find((a) => !a.success);
      const platform =
        lastFailed?.platform ||
        getPlatformsForPost(selectedPost)[0] ||
        "all";
      const res = await fetch("/api/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          postId: selectedPost.id,
          platform,
          action: "publish",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPublishError(
          data?.error ??
            (data?.code === "score_gate"
              ? data?.autoRewriting
                ? "This post's score is below the publish minimum — auto-rewriting it now. Try publishing again in about a minute."
                : "This post's score is below the publish minimum. Improve or regenerate the content first."
              : "Publish failed — see details below.")
        );
        return;
      }
      // Refresh the attempt log so the new attempt shows up.
      const attRes = await fetch(`/api/posts/${selectedPost.id}/attempts`);
      if (attRes.ok) {
        const attData = await attRes.json();
        setPostAttempts(attData.attempts ?? []);
      }
      if (data?.success === false) {
        setPublishError("Some platforms failed — see the attempt log below.");
      }
    } catch {
      setPublishError("Retry failed — please try again.");
    } finally {
      setRetrying(false);
    }
  }, [selectedPost, retrying, postAttempts]);

  // Regenerate a blog through Cheryl's pipeline. An optional `feedback` string
  // (the owner's "why") guides the rewrite to their preferred style/result.
  const regeneratePost = useCallback(
    async (feedback?: string): Promise<boolean> => {
      if (!selectedPost || regenerating) return false;
      setRegenerating(true);
      setPublishError(null);
      try {
        const res = await fetch(`/api/posts/${selectedPost.id}/regenerate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ feedback: feedback?.trim() || undefined }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setPublishError(data?.error ?? "Regeneration failed.");
          return false;
        }
        await onPostUpdate(selectedPost.id, {}); // refresh list
        setSelectedPost(null);
        return true;
      } catch {
        setPublishError("Regeneration failed — please try again.");
        return false;
      } finally {
        setRegenerating(false);
      }
    },
    [selectedPost, regenerating, onPostUpdate]
  );

  // Rewrite-with-feedback: open the dialog, collect the "why", then regenerate.
  const openRewriteDialog = useCallback(() => {
    if (!selectedPost) return;
    setRewritePost(selectedPost);
    setRewriteFeedback("");
    setPublishError(null);
  }, [selectedPost]);

  const submitRewrite = useCallback(async () => {
    if (!rewritePost || !rewriteFeedback.trim()) return;
    const ok = await regeneratePost(rewriteFeedback.trim());
    if (ok) setRewritePost(null);
  }, [rewritePost, rewriteFeedback, regeneratePost]);

  // Render the SEO checklist stored on the post (seo_checks JSONB).
  const renderSeoChecks = useCallback(() => {
    if (!selectedPost?.seo_checks) return null;
    const raw = Array.isArray(selectedPost.seo_checks)
      ? selectedPost.seo_checks
      : typeof selectedPost.seo_checks === "string"
        ? (() => {
            try {
              return JSON.parse(selectedPost.seo_checks);
            } catch {
              return [];
            }
          })()
        : [];
    const checks = (raw as { label?: string; passed?: boolean; detail?: string }[]).filter(
      (c) => typeof c?.label === "string"
    );
    if (checks.length === 0) return null;
    return (
      <div className="space-y-1">
        {checks.map((c, i) => (
          <div
            key={i}
            className="flex items-start gap-2 text-xs"
            title={c.detail ?? ""}
          >
            <span
              className={cn(
                "mt-0.5 inline-flex size-3.5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold",
                c.passed
                  ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400"
                  : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400"
              )}
            >
              {c.passed ? "✓" : "✗"}
            </span>
            <span
              className={cn(
                c.passed
                  ? "text-muted-foreground"
                  : "text-red-700 dark:text-red-400"
              )}
            >
              {c.label}
            </span>
          </div>
        ))}
      </div>
    );
  }, [selectedPost]);

  // ---- Calendar grid generation ----
  const days = useMemo(() => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    const calStart = startOfWeek(monthStart, { weekStartsOn: 0 });
    const calEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
    return eachDayOfInterval({ start: calStart, end: calEnd });
  }, [currentMonth]);

  // Group posts by day (string key)
  const postsByDay = useMemo(() => {
    const map = new Map<string, CalendarPost[]>();
    for (const post of posts) {
      if (!post.scheduled_at) continue;
      const dateKey = format(parseISO(post.scheduled_at), "yyyy-MM-dd");
      const existing = map.get(dateKey) ?? [];
      existing.push(post);
      map.set(dateKey, existing);
    }
    return map;
  }, [posts]);

  // Group proposed campaign-plan items by day.
  const proposedByDay = useMemo(() => {
    const map = new Map<string, ProposedItem[]>();
    for (const item of proposedItems) {
      const existing = map.get(item.date) ?? [];
      existing.push(item);
      map.set(item.date, existing);
    }
    return map;
  }, [proposedItems]);

  // ---- Navigation ----
  const prevMonth = useCallback(() => {
    setCurrentMonth((m) => subMonths(m, 1));
  }, []);

  const nextMonth = useCallback(() => {
    setCurrentMonth((m) => addMonths(m, 1));
  }, []);

  const goToToday = useCallback(() => {
    setCurrentMonth(new Date());
  }, []);

  // ---- Status toggle ----
  const toggleStatus = useCallback(
    (status: PostStatus) => {
      if (selectedStatuses.includes(status)) {
        onStatusesChange(selectedStatuses.filter((s) => s !== status));
      } else {
        onStatusesChange([...selectedStatuses, status]);
      }
    },
    [selectedStatuses, onStatusesChange]
  );

  // ---- Per-post analytics state ----
  const [postAnalytics, setPostAnalytics] = useState<AnalyticsSnapshot[] | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  // Fetch analytics snapshots + publish attempts when the selected post changes
  useEffect(() => {
    if (!selectedPost) {
      setPostAnalytics(null);
      setPostAttempts([]);
      return;
    }

    let cancelled = false;

    async function load() {
      setAnalyticsLoading(true);
      setAttemptsLoading(true);
      try {
        const [anaRes, attRes] = await Promise.all([
          fetch(`/api/analytics?postId=${selectedPost!.id}`),
          fetch(`/api/posts/${selectedPost!.id}/attempts`),
        ]);
        if (cancelled) return;
        if (anaRes.ok) {
          const data = await anaRes.json();
          setPostAnalytics(data.snapshots ?? []);
        } else {
          setPostAnalytics(null);
        }
        if (attRes.ok) {
          const data = await attRes.json();
          setPostAttempts(data.attempts ?? []);
        } else {
          setPostAttempts([]);
        }
      } catch {
        if (!cancelled) {
          setPostAnalytics(null);
          setPostAttempts([]);
        }
      } finally {
        if (!cancelled) {
          setAnalyticsLoading(false);
          setAttemptsLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [selectedPost]);

  // Build chart data for the selected post (grouped by fetched_at date)
  const postChartData = useMemo(() => {
    if (!postAnalytics || postAnalytics.length === 0) return [];
    const byDate = new Map<
      string,
      { date: string; likes: number; comments: number; shares: number }
    >();
    for (const snap of postAnalytics) {
      const dateKey = format(parseISO(snap.fetched_at), "MMM d ha");
      const existing = byDate.get(dateKey) ?? {
        date: dateKey,
        likes: 0,
        comments: 0,
        shares: 0,
      };
      existing.likes += snap.likes;
      existing.comments += snap.comments;
      existing.shares += snap.shares;
      byDate.set(dateKey, existing);
    }
    return Array.from(byDate.values());
  }, [postAnalytics]);

  // Derived analytics aggregates (computed once, used in JSX)
  const analyticsTotals = useMemo(() => {
    if (!postAnalytics || postAnalytics.length === 0) return null;
    const totalLikes = postAnalytics.reduce((s, sn) => s + sn.likes, 0);
    const totalComments = postAnalytics.reduce((s, sn) => s + sn.comments, 0);
    const totalShares = postAnalytics.reduce((s, sn) => s + sn.shares, 0);
    const totalImpressions = postAnalytics.reduce((s, sn) => s + sn.impressions, 0);
    const totalReach = postAnalytics.reduce((s, sn) => s + sn.reach, 0);
    const engRate =
      totalImpressions > 0
        ? ((totalLikes + totalComments + totalShares) / totalImpressions) * 100
        : 0;
    return {
      totalLikes,
      totalComments,
      totalShares,
      totalImpressions,
      totalReach,
      engRate,
    };
  }, [postAnalytics]);

  // ---- Detail modal actions ----
  const handleApprove = useCallback(async () => {
    if (!selectedPost) return;
    await onPostUpdate(selectedPost.id, { status: "approved" });
    setSelectedPost(null);
    onRefresh();
  }, [selectedPost, onPostUpdate, onRefresh]);

  // Request Revision: ask WHY before sending content back — the reason is
  // persisted and shown on the post so the team knows what to change.
  const openRevisionDialog = useCallback(() => {
    if (!selectedPost) return;
    setRevisionPost(selectedPost);
    setRevisionReason("");
    setRevisionTarget("text");
  }, [selectedPost]);

  const submitRevision = useCallback(async () => {
    if (!revisionPost) return;
    const reason = revisionReason.trim();
    if (!reason) return;
    setRevisionSaving(true);
    try {
      // Scope prefix so the team knows what to change: [Text], [Images], or
      // [Text + Images]. Kept in the reason string — no schema change needed.
      const targetLabel =
        revisionTarget === "images"
          ? "[Images]"
          : revisionTarget === "both"
            ? "[Text + Images]"
            : "[Text]";
      await onPostUpdate(revisionPost.id, {
        status: "revision_requested",
        revision_reason: `${targetLabel} ${reason}`,
      });
      setRevisionPost(null);
      setSelectedPost(null);
      onRefresh();
    } finally {
      setRevisionSaving(false);
    }
  }, [revisionPost, revisionReason, revisionTarget, onPostUpdate, onRefresh]);

  return (
    <div className="flex gap-6 h-full">
      {/* ---- Sidebar Filters ---- */}
      <aside className="w-64 shrink-0 space-y-6">
        <div>
          <h3 className="text-sm font-semibold mb-3">Client</h3>
          <select
            className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            value={selectedClientId ?? ""}
            onChange={(e) =>
              onClientChange(e.target.value || null)
            }
          >
            <option value="">All Clients</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <h3 className="text-sm font-semibold mb-3">Status</h3>
          <div className="space-y-1.5">
            {ALL_STATUSES.map((status) => {
              const config = STATUS_CONFIG[status];
              const isSelected = selectedStatuses.includes(status);
              return (
                <label
                  key={status}
                  className="flex items-center gap-2 cursor-pointer text-sm py-1 px-2 rounded hover:bg-muted transition-colors"
                >
                  <input
                    type="checkbox"
                    className="rounded border-gray-300"
                    checked={isSelected}
                    onChange={() => toggleStatus(status)}
                  />
                  <span
                    className={cn(
                      "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium",
                      config.className
                    )}
                  >
                    {config.label}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      </aside>

      {/* ---- Calendar ---- */}
      <div className="flex-1 min-w-0">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" onClick={prevMonth}>
              <ChevronLeft className="size-4" />
            </Button>
            <h2 className="text-xl font-bold min-w-[180px] text-center">
              {format(currentMonth, "MMMM yyyy")}
            </h2>
            <Button variant="outline" size="icon" onClick={nextMonth}>
              <ChevronRight className="size-4" />
            </Button>
          </div>
          <Button variant="ghost" size="sm" onClick={goToToday}>
            <CalendarIcon className="size-4 mr-1" />
            Today
          </Button>
        </div>

        {/* Day-of-week header */}
        <div className="grid grid-cols-7 mb-1">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div
              key={d}
              className="text-center text-xs font-semibold text-muted-foreground py-2 border-b"
            >
              {d}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 border-l border-t">
            {days.map((day) => {
              const dateKey = format(day, "yyyy-MM-dd");
              const dayPosts = postsByDay.get(dateKey) ?? [];
              const dayProposed = proposedByDay.get(dateKey) ?? [];
              const isCurrentMonth = isSameMonth(day, currentMonth);
              const isToday = isSameDay(day, new Date());

              return (
                <div
                  key={dateKey}
                  className={cn(
                    "min-h-[110px] border-r border-b p-1.5 transition-colors",
                    !isCurrentMonth && "bg-muted/30 text-muted-foreground",
                    isToday && "bg-accent/20"
                  )}
                >
                  <span
                    className={cn(
                      "text-xs font-medium mb-1 inline-block px-1 py-0.5 rounded",
                      isToday &&
                        "bg-primary text-primary-foreground"
                    )}
                  >
                    {format(day, "d")}
                  </span>

                  <div className="space-y-0.5">
                    {dayPosts.map((post) => {
                      const platforms = getPlatformsForPost(post);
                      return (
                        <div
                          key={post.id}
                          className="bg-card border rounded-md px-2 py-1.5 cursor-pointer hover:shadow-md transition-shadow text-xs"
                          onClick={() => setSelectedPost(post)}
                        >
                          <div className="flex items-center gap-1 mb-0.5">
                            {platforms.map((p) => (
                              <span
                                key={p}
                                title={p}
                                className="text-[10px] leading-none"
                              >
                                {PLATFORM_ICONS[p] ?? p}
                              </span>
                            ))}
                          </div>
                          <p className="truncate text-muted-foreground leading-tight">
                            {excerptFromContent(post.content)}
                          </p>
                          <span
                            className={cn(
                              "inline-block mt-1 px-1.5 py-px rounded-full text-[10px] font-medium",
                              STATUS_CONFIG[post.status]?.className ??
                                "bg-gray-100 text-gray-700"
                            )}
                          >
                            {STATUS_CONFIG[post.status]?.label ??
                              post.status}
                          </span>
                        </div>
                      );
                    })}

                        {/* Proposed pieces from campaign plans — dashed until approved. */}
                        {dayProposed.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            title={`${item.planTitle} — proposed ${item.kind}. Click to open.`}
                            onClick={() => setSelectedProposed(item)}
                            className="w-full text-left border border-dashed rounded-md px-2 py-1 text-xs opacity-80 hover:opacity-100 hover:border-violet-400 hover:bg-violet-50 dark:hover:bg-violet-950/40 cursor-pointer transition-colors"
                          >
                            <div className="flex items-center gap-1 mb-0.5">
                              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                {item.kind === "website"
                                  ? "🌐"
                                  : item.kind === "research"
                                    ? "🔎"
                                    : item.kind === "blog"
                                      ? "📝"
                                      : (PLATFORM_ICONS[item.platform ?? ""] ?? "📣")}
                              </span>
                              <span className="text-[10px] font-medium text-muted-foreground">
                                {item.kind === "website"
                                  ? "Proposed website build"
                                  : item.kind === "research"
                                    ? "Research checkpoint"
                                    : item.kind === "blog"
                                      ? "Proposed blog"
                                      : "Proposed social"}
                              </span>
                            </div>
                            <p className="truncate text-muted-foreground leading-tight">
                              {item.title}
                            </p>
                            <span className="inline-flex items-center gap-1.5 mt-1">
                              <span className="px-1.5 py-px rounded-full text-[10px] font-medium bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
                                Proposed
                              </span>
                              {item.owner && (
                                <span className="px-1.5 py-px rounded-full text-[10px] font-medium bg-muted text-muted-foreground">
                                  {OWNER_NAMES[item.owner] ?? item.owner}
                                </span>
                              )}
                            </span>
                          </button>
                        ))}
                      </div>
                  </div>
                );
              })}
            </div>

        {/* Legend */}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-sm bg-violet-200 dark:bg-violet-800 border border-dashed border-violet-400" />
            Proposed (campaign plan)
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-sm bg-card border" />
            Post (click to view)
          </span>
        </div>
      </div>

      {/* ---- Post Detail Dialog ---- */}
      <Dialog open={!!selectedPost} onOpenChange={(open) => !open && setSelectedPost(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Post Detail</DialogTitle>
            <DialogDescription>
              {selectedPost?.scheduled_at
                ? format(
                    parseISO(selectedPost.scheduled_at),
                    "MMMM d, yyyy 'at' h:mm a"
                  )
                : "Unscheduled"}
            </DialogDescription>
          </DialogHeader>

          {selectedPost && (
            <Tabs defaultValue="details" className="w-full">
              <TabsList className="w-full">
                <TabsTrigger value="details" className="flex-1">
                  Details
                </TabsTrigger>
                <TabsTrigger value="analytics" className="flex-1">
                  <BarChart3 className="size-3.5 mr-1" />
                  Analytics
                </TabsTrigger>
              </TabsList>

              {/* ---- Details Tab ---- */}
              <TabsContent value="details" className="space-y-4 mt-4">
                {/* Status badge */}
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Status:</span>
                  <span
                    className={cn(
                      "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium",
                      STATUS_CONFIG[selectedPost.status]?.className
                    )}
                  >
                    {STATUS_CONFIG[selectedPost.status]?.label ??
                      selectedPost.status}
                  </span>
                </div>

                {/* Why it was sent back — so the team can actually fix it */}
                {selectedPost.revision_reason && (
                  <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-sm dark:bg-amber-950/30 dark:border-amber-800">
                    <span className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                      Revision requested
                    </span>
                    <p className="mt-0.5 text-amber-900 dark:text-amber-200">
                      {selectedPost.revision_reason}
                    </p>
                  </div>
                )}

                {/* Platforms */}
                {getPlatformsForPost(selectedPost).length > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">Platforms:</span>
                    <span className="flex gap-1">
                      {getPlatformsForPost(selectedPost).map((p) => (
                        <span key={p} className="text-lg" title={p}>
                          {PLATFORM_ICONS[p] ?? p}
                        </span>
                      ))}
                    </span>
                  </div>
                )}

                {/* Content — blog bodies render as markdown so images display */}
                <div>
                  <h4 className="text-sm font-medium mb-1">Content</h4>
                  <div className="text-sm text-muted-foreground bg-muted/50 rounded-md p-3 max-h-48 overflow-y-auto">
                    <PostContent content={selectedPost.content} />
                  </div>
                </div>

                {/* SEO score + checklist (Rank Math-style) */}
                {selectedPost.seo_score != null && (
                  <div className="rounded-md bg-muted/50 border px-3 py-2">
                    <div className="flex items-center justify-between mb-1.5">
                      <h4 className="text-sm font-medium">SEO Score</h4>
                      <ScoreBadge score={selectedPost.seo_score} />
                    </div>
                    <p
                      className={cn(
                        "text-[11px] font-medium mb-2",
                        (selectedPost.seo_score ?? 0) >= 80
                          ? "text-green-600 dark:text-green-400"
                          : (selectedPost.seo_score ?? 0) >= 50
                            ? "text-amber-600 dark:text-amber-400"
                            : "text-red-600 dark:text-red-400"
                      )}
                    >
                      {(selectedPost.seo_score ?? 0) >= 80
                        ? "Strong — ready to publish."
                        : (selectedPost.seo_score ?? 0) >= 50
                          ? "Passable — publishable, but improvement helps."
                          : "Below the publish minimum — regenerate or improve before publishing."}
                    </p>
                    {renderSeoChecks()}
                  </div>
                )}

                {/* Publish attempt log — why and when it failed */}
                {attemptsLoading ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="size-3 animate-spin" />
                    Loading publish history…
                  </div>
                ) : postAttempts.length > 0 ? (
                  <div>
                    <h4 className="text-sm font-medium mb-1.5">
                      Publish History
                    </h4>
                    <div className="space-y-1.5 max-h-36 overflow-y-auto">
                      {postAttempts.map((a) => (
                        <div
                          key={a.id}
                          className={cn(
                            "rounded-md border px-2.5 py-1.5 text-xs",
                            a.success
                              ? "bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800"
                              : "bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800"
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium capitalize">
                              {a.platform} —{" "}
                              {a.success ? "Succeeded" : "Failed"}
                            </span>
                            <span className="text-muted-foreground">
                              {format(parseISO(a.attempt_at), "MMM d, h:mm a")}
                            </span>
                          </div>
                          {!a.success && a.error_message && (
                            <p className="mt-0.5 text-red-700 dark:text-red-400 break-words">
                              {a.error_message}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {publishError && (
                  <div className="flex items-start gap-2 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700 dark:bg-red-950/30 dark:border-red-800 dark:text-red-400">
                    <AlertTriangle className="size-3.5 mt-0.5 shrink-0" />
                    <span>{publishError}</span>
                  </div>
                )}

                {/* Media — click any thumbnail to view full size */}
                {selectedPost.media_urls && selectedPost.media_urls.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium mb-1">Media</h4>
                    <div className="flex gap-2 flex-wrap">
                      {selectedPost.media_urls.map((url, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => setLightboxUrl(url)}
                          title="Click to view full size"
                          className="rounded-md border overflow-hidden hover:ring-2 hover:ring-primary/40 transition-shadow"
                        >
                          <img
                            src={url}
                            alt={`Media ${i + 1} — click to enlarge`}
                            className="size-16 object-cover"
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Meta */}
                <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                  <div>
                    <span className="font-medium">AI Generated:</span>{" "}
                    {selectedPost.ai_generated ? "Yes" : "No"}
                  </div>
                  <div>
                    <span className="font-medium">Tier:</span>{" "}
                    {selectedPost.tier_level ?? "—"}
                  </div>
                </div>
              </TabsContent>

              {/* ---- Analytics Tab ---- */}
              <TabsContent value="analytics" className="space-y-4 mt-4">
                {analyticsLoading ? (
                  <div className="flex items-center justify-center py-12 text-muted-foreground">
                    <Loader2 className="size-5 animate-spin mr-2" />
                    Loading analytics…
                  </div>
                ) : postAnalytics && postAnalytics.length > 0 && analyticsTotals ? (
                  <>
                    {/* Summary cards for this post */}
                    <div className="grid grid-cols-3 gap-2">
                      <div className="bg-muted/50 rounded-lg p-3 text-center">
                        <ThumbsUp className="size-4 mx-auto text-blue-500 mb-1" />
                        <p className="text-lg font-bold">{formatNumber(analyticsTotals.totalLikes)}</p>
                        <p className="text-[10px] text-muted-foreground">Likes</p>
                      </div>
                      <div className="bg-muted/50 rounded-lg p-3 text-center">
                        <MessageCircle className="size-4 mx-auto text-amber-500 mb-1" />
                        <p className="text-lg font-bold">{formatNumber(analyticsTotals.totalComments)}</p>
                        <p className="text-[10px] text-muted-foreground">Comments</p>
                      </div>
                      <div className="bg-muted/50 rounded-lg p-3 text-center">
                        <Share2 className="size-4 mx-auto text-green-500 mb-1" />
                        <p className="text-lg font-bold">{formatNumber(analyticsTotals.totalShares)}</p>
                        <p className="text-[10px] text-muted-foreground">Shares</p>
                      </div>
                      <div className="bg-muted/50 rounded-lg p-3 text-center">
                        <Eye className="size-4 mx-auto text-purple-500 mb-1" />
                        <p className="text-lg font-bold">{formatNumber(analyticsTotals.totalImpressions)}</p>
                        <p className="text-[10px] text-muted-foreground">Impressions</p>
                      </div>
                      <div className="bg-muted/50 rounded-lg p-3 text-center">
                        <Eye className="size-4 mx-auto text-teal-500 mb-1" />
                        <p className="text-lg font-bold">{formatNumber(analyticsTotals.totalReach)}</p>
                        <p className="text-[10px] text-muted-foreground">Reach</p>
                      </div>
                      <div className="bg-muted/50 rounded-lg p-3 text-center">
                        <TrendingUp className="size-4 mx-auto text-rose-500 mb-1" />
                        <p className="text-lg font-bold">{analyticsTotals.engRate.toFixed(1)}%</p>
                        <p className="text-[10px] text-muted-foreground">Eng. Rate</p>
                      </div>
                    </div>

                    {/* Mini line chart for this post */}
                    {postChartData.length > 0 && (
                      <div>
                        <h4 className="text-sm font-medium mb-2">Performance Over Time</h4>
                        <div className="h-40 w-full">
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={postChartData}>
                              <CartesianGrid strokeDasharray="3 3" />
                              <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                              <YAxis tick={{ fontSize: 10 }} width={32} />
                              <RechartsTooltip />
                              <Line
                                type="monotone"
                                dataKey="likes"
                                stroke="#3b82f6"
                                strokeWidth={1.5}
                                dot={{ r: 2 }}
                                name="Likes"
                              />
                              <Line
                                type="monotone"
                                dataKey="comments"
                                stroke="#f59e0b"
                                strokeWidth={1.5}
                                dot={{ r: 2 }}
                                name="Comments"
                              />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    )}

                    {/* Snapshot table */}
                    <div>
                      <h4 className="text-sm font-medium mb-2">
                        Snapshots ({postAnalytics.length})
                      </h4>
                      <div className="max-h-36 overflow-y-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b text-muted-foreground">
                              <th className="text-left pb-1 font-medium">Platform</th>
                              <th className="text-right pb-1 font-medium">Likes</th>
                              <th className="text-right pb-1 font-medium">Comments</th>
                              <th className="text-right pb-1 font-medium">Shares</th>
                              <th className="text-right pb-1 font-medium">Reach</th>
                            </tr>
                          </thead>
                          <tbody>
                            {postAnalytics.slice(-10).reverse().map((snap) => (
                              <tr key={snap.id} className="border-b last:border-0">
                                <td className="py-1.5 capitalize">{snap.platform}</td>
                                <td className="py-1.5 text-right">{snap.likes}</td>
                                <td className="py-1.5 text-right">{snap.comments}</td>
                                <td className="py-1.5 text-right">{snap.shares}</td>
                                <td className="py-1.5 text-right">{formatNumber(snap.reach)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="text-center text-sm text-muted-foreground py-12">
                    No analytics data yet. Snapshots are collected every 6 hours after a post is published.
                  </p>
                )}
              </TabsContent>
            </Tabs>
          )}

          <DialogFooter className="gap-2">
            {(selectedPost?.status === "pending_approval" ||
              selectedPost?.status === "draft") && (
              <Button variant="default" onClick={handleApprove}>
                Approve
              </Button>
            )}
            {selectedPost &&
              isBlogPost(selectedPost) &&
              (selectedPost.status === "draft" ||
                selectedPost.status === "pending_approval" ||
                selectedPost.status === "revision_requested") && (
                <Button variant="outline" onClick={openRewriteDialog}>
                  <RefreshCw className="size-4 mr-1" />
                  Rewrite with AI
                </Button>
              )}
            {(selectedPost?.status === "pending_approval" ||
              selectedPost?.status === "approved" ||
              selectedPost?.status === "draft" ||
              selectedPost?.status === "revision_requested" ||
              selectedPost?.status === "failed" ||
              selectedPost?.status === "published") && (
              <Button variant="outline" onClick={openRevisionDialog}>
                Request Revision
              </Button>
            )}
            {selectedPost?.status === "failed" && (
              <>
                <Button
                  variant="outline"
                  onClick={retryPublish}
                  disabled={retrying}
                >
                  {retrying ? (
                    <Loader2 className="size-4 animate-spin mr-1" />
                  ) : (
                    <RotateCcw className="size-4 mr-1" />
                  )}
                  Retry Publish
                </Button>
                <Button
                  variant="outline"
                  onClick={() => void regeneratePost()}
                  disabled={regenerating}
                >
                  {regenerating ? (
                    <Loader2 className="size-4 animate-spin mr-1" />
                  ) : (
                    <RefreshCw className="size-4 mr-1" />
                  )}
                  Regenerate
                </Button>
              </>
            )}
            {selectedPost?.status === "draft" &&
              isBrokenBlogPost(selectedPost) && (
                <Button
                  variant="outline"
                  onClick={() => void regeneratePost()}
                  disabled={regenerating}
                >
                  {regenerating ? (
                    <Loader2 className="size-4 animate-spin mr-1" />
                  ) : (
                    <RefreshCw className="size-4 mr-1" />
                  )}
                  Regenerate broken draft
                </Button>
              )}
            <Button
              variant="ghost"
              onClick={() => setSelectedPost(null)}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Image lightbox — full-size media preview */}
      <Dialog
        open={!!lightboxUrl}
        onOpenChange={(open) => !open && setLightboxUrl(null)}
      >
        <DialogContent className="sm:max-w-3xl">
          {lightboxUrl && (
            <div className="flex flex-col items-center gap-3">
              <div className="flex items-center justify-center w-full">
                <img
                  src={lightboxUrl}
                  alt="Full-size media"
                  className="max-h-[70vh] w-auto rounded-md border"
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLightboxUrl(null)}
              >
                Close image
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Request Revision — ask WHY before sending content back */}
      <Dialog
        open={!!revisionPost}
        onOpenChange={(open) => !open && setRevisionPost(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Request Revision</DialogTitle>
            <DialogDescription>
              Tell the team what needs to change — the reason is saved on the
              post so the revision actually gets addressed.
            </DialogDescription>
          </DialogHeader>
          <div>
            <span className="text-xs font-medium text-muted-foreground">
              What needs revising?
            </span>
            <div className="flex gap-2 mt-1.5">
              {(
                [
                  { id: "text" as const, label: "✍️ Text" },
                  { id: "images" as const, label: "🖼️ Images" },
                  { id: "both" as const, label: "✍️🖼️ Both" },
                ]
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setRevisionTarget(opt.id)}
                  className={`flex-1 rounded-md border px-3 py-2 text-xs font-medium transition-colors ${
                    revisionTarget === opt.id
                      ? "border-primary bg-primary/10 text-primary"
                      : "hover:bg-muted"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <textarea
            value={revisionReason}
            onChange={(e) => setRevisionReason(e.target.value)}
            rows={4}
            placeholder={
              revisionTarget === "images"
                ? "e.g. The featured image doesn't match the topic — use a photo of the actual product and add alt text."
                : revisionTarget === "both"
                  ? "e.g. Tighten the intro and swap the hero image for a real product shot."
                  : "e.g. The opening hook is weak — lead with the 2026 stats. Add more detail on the amenities section and fix the CTA."
            }
            className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <DialogFooter className="gap-2">
            <Button
              variant="default"
              disabled={!revisionReason.trim() || revisionSaving}
              onClick={submitRevision}
            >
              {revisionSaving ? (
                <Loader2 className="size-4 animate-spin mr-1" />
              ) : (
                <ThumbsUp className="size-4 mr-1" />
              )}
              Send Back for Revision
            </Button>
            <Button variant="ghost" onClick={() => setRevisionPost(null)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rewrite with AI — ask WHY so the rewrite is guided to the preferred
          style/result. */}
      <Dialog
        open={!!rewritePost}
        onOpenChange={(open) => !open && setRewritePost(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rewrite with AI</DialogTitle>
            <DialogDescription>
              Describe what you want changed and Cheryl will regenerate the
              post to match.
            </DialogDescription>
          </DialogHeader>
          <textarea
            value={rewriteFeedback}
            onChange={(e) => setRewriteFeedback(e.target.value)}
            rows={5}
            placeholder="e.g. Make the tone more casual and conversational, lead with the 2026 stats, shorten the intro, and end with a stronger call to action."
            className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <DialogFooter className="gap-2">
            <Button
              variant="default"
              disabled={!rewriteFeedback.trim() || regenerating}
              onClick={submitRewrite}
            >
              {regenerating ? (
                <Loader2 className="size-4 animate-spin mr-1" />
              ) : (
                <RefreshCw className="size-4 mr-1" />
              )}
              Rewrite
            </Button>
            <Button variant="ghost" onClick={() => setRewritePost(null)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Proposed campaign item — click to open, approve to turn it into a
          real draft post on its due date. */}
      <Dialog
        open={!!selectedProposed}
        onOpenChange={(open) => !open && setSelectedProposed(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Proposed {selectedProposed?.kind}</DialogTitle>
            <DialogDescription>
              {selectedProposed
                ? `${selectedProposed.planTitle} — ${format(
                    parseISO(selectedProposed.date),
                    "MMMM d, yyyy"
                  )}`
                : ""}
            </DialogDescription>
          </DialogHeader>

          {selectedProposed && (
            <div className="space-y-3 text-sm">
              <div>
                <span className="text-muted-foreground text-xs uppercase tracking-wide font-semibold">
                  Topic
                </span>
                <p className="font-medium mt-0.5">{selectedProposed.title}</p>
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                <div>
                  <span className="text-muted-foreground text-xs uppercase tracking-wide font-semibold">
                    Type
                  </span>
                  <p className="mt-0.5 capitalize">{selectedProposed.kind}</p>
                </div>
                {selectedProposed.platform && (
                  <div>
                    <span className="text-muted-foreground text-xs uppercase tracking-wide font-semibold">
                      Platform
                    </span>
                    <p className="mt-0.5 capitalize">{selectedProposed.platform}</p>
                  </div>
                )}
                {selectedProposed.owner && (
                  <div>
                    <span className="text-muted-foreground text-xs uppercase tracking-wide font-semibold">
                      Owner
                    </span>
                    <p className="mt-0.5">
                      {OWNER_NAMES[selectedProposed.owner] ?? selectedProposed.owner}
                    </p>
                  </div>
                )}
              </div>

              {/* Approved keywords — the piece will target these */}
              {selectedProposed.keywords && selectedProposed.keywords.length > 0 && (
                <div>
                  <span className="text-muted-foreground text-xs uppercase tracking-wide font-semibold">
                    Target keywords
                  </span>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {selectedProposed.keywords.map((kw) => (
                      <span
                        key={kw}
                        className="inline-flex items-center rounded-full border border-primary/30 bg-primary/5 px-2.5 py-0.5 text-xs font-medium text-primary"
                      >
                        {kw}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Internal link target — content should link here */}
              {selectedProposed.internalLink && (
                <div>
                  <span className="text-muted-foreground text-xs uppercase tracking-wide font-semibold">
                    Links to internally
                  </span>
                  <p className="mt-0.5 text-primary break-all">
                    {selectedProposed.internalLink}
                  </p>
                </div>
              )}

              {/* External link targets — reputable sources to cite */}
              {selectedProposed.externalLinks && selectedProposed.externalLinks.length > 0 && (
                <div>
                  <span className="text-muted-foreground text-xs uppercase tracking-wide font-semibold">
                    Suggested external sources
                  </span>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {selectedProposed.externalLinks.map((link) => (
                      <span
                        key={link}
                        className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground break-all"
                      >
                        {link}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Research checkpoints: no content generation — approving
                  marks the foundation step done. */}
              {selectedProposed.kind === "research" && (
                <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-muted-foreground dark:bg-amber-950/40 dark:border-amber-800">
                  <p className="font-medium text-amber-700 dark:text-amber-300 mb-0.5">🔎 Foundation research</p>
                  <p>
                    Voice &amp; tone, brand persona, and buyer-persona research
                    ground everything the team produces. Approving marks it done
                    — no content is generated for research checkpoints.
                  </p>
                </div>
              )}

              {/* Website milestones: no content generation — approving marks
                  the build step active and points at the Web Builder. */}
              {selectedProposed.kind === "website" && (
                <div className="rounded-md bg-primary/5 border border-primary/20 px-3 py-2 text-xs text-muted-foreground">
                  <p className="font-medium text-primary mb-0.5">🌐 Website build milestone</p>
                  <p>
                    Approving marks this step in progress — Ray&apos;s build is
                    tracked here and the actual page building happens in the{" "}
                    <span className="font-medium">Web Builder</span>. No content
                    is generated for website milestones.
                  </p>
                </div>
              )}

              {/* Media kind — socials default to image today; video ships later */}
              {selectedProposed.kind === "social" && (
                <div>
                  <span className="text-muted-foreground text-xs uppercase tracking-wide font-semibold">
                    Media
                  </span>
                  <div className="flex gap-2 mt-1.5">
                    <button
                      type="button"
                      onClick={() => setMediaKind("image")}
                      className={`flex-1 rounded-md border px-3 py-2 text-xs font-medium transition-colors ${
                        mediaKind === "image"
                          ? "border-primary bg-primary/10 text-primary"
                          : "hover:bg-muted"
                      }`}
                    >
                      🖼️ Image
                      <span className="block font-normal text-muted-foreground mt-0.5">Available now</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setMediaKind("video")}
                      className={`flex-1 rounded-md border px-3 py-2 text-xs font-medium transition-colors ${
                        mediaKind === "video"
                          ? "border-primary bg-primary/10 text-primary"
                          : "hover:bg-muted"
                      }`}
                    >
                      🎬 Video
                      <span className="block font-normal text-muted-foreground mt-0.5">Coming soon — image used until then</span>
                    </button>
                  </div>
                </div>
              )}

              {selectedProposed.kind !== "website" && (
                <div className="rounded-md bg-muted/50 border px-3 py-2 text-xs text-muted-foreground space-y-1">
                  <p>
                    Approving this idea generates the content now (Cheryl writes
                    blogs with images, Pam writes social captions) and lands it as
                    pending approval. The generated content needs a second, human
                    approval before it can be scheduled or published.
                  </p>
                  <p className="pt-1">
                    The generated piece is scored against the SEO checklist
                    (keywords in title/meta/slug/body, image alt text, internal &
                    external links, readability) and the score shows on the post
                    before you approve it for publishing.
                  </p>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button
              variant="default"
              disabled={approving}
              onClick={async () => {
                if (!selectedProposed) return;
                setApproving(true);
                try {
                  await onApproveProposed(selectedProposed, mediaKind);
                  setSelectedProposed(null);
                  setMediaKind("image");
                } finally {
                  setApproving(false);
                }
              }}
            >
              {approving ? (
                <Loader2 className="size-4 animate-spin mr-1" />
              ) : (
                <ThumbsUp className="size-4 mr-1" />
              )}
              {selectedProposed?.kind === "website"
                ? "Approve milestone"
                : selectedProposed?.kind === "research"
                  ? "Approve checkpoint"
                  : "Approve & Generate"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => setSelectedProposed(null)}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}