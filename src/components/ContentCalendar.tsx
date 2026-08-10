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
  DragDropContext,
  Droppable,
  Draggable,
  type DropResult,
  type DroppableProvided,
  type DroppableStateSnapshot,
} from "@hello-pangea/dnd";
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
  clients: Client[];
  selectedClientId: string | null;
  selectedStatuses: PostStatus[];
  onClientChange: (clientId: string | null) => void;
  onStatusesChange: (statuses: PostStatus[]) => void;
  onPostReschedule: (postId: string, newDate: string) => Promise<void>;
  onPostUpdate: (postId: string, data: Partial<Pick<CalendarPost, "status">>) => Promise<void>;
  onRefresh: () => void;
}

export default function ContentCalendar({
  posts,
  clients,
  selectedClientId,
  selectedStatuses,
  onClientChange,
  onStatusesChange,
  onPostReschedule,
  onPostUpdate,
  onRefresh,
}: ContentCalendarProps) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedPost, setSelectedPost] = useState<CalendarPost | null>(null);
  const [isDragging, setIsDragging] = useState(false);

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

  // ---- Drag & Drop ----
  const handleDragStart = useCallback(() => {
    setIsDragging(true);
  }, []);

  const handleDragEnd = useCallback(
    async (result: DropResult) => {
      setIsDragging(false);

      const { draggableId, destination } = result;
      if (!destination) return;

      // draggableId format: "post-{id}"
      const postId = draggableId.replace("post-", "");
      // destination.droppableId format: "day-{yyyy-MM-dd}"
      const newDate = destination.droppableId.replace("day-", "");

      await onPostReschedule(postId, newDate);
      onRefresh();
    },
    [onPostReschedule, onRefresh]
  );

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

  // Fetch analytics snapshots when the selected post changes
  useEffect(() => {
    if (!selectedPost) {
      setPostAnalytics(null);
      return;
    }

    let cancelled = false;

    async function load() {
      setAnalyticsLoading(true);
      try {
        const res = await fetch(`/api/analytics?postId=${selectedPost!.id}`);
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          setPostAnalytics(data.snapshots ?? []);
        } else {
          setPostAnalytics(null);
        }
      } catch {
        if (!cancelled) setPostAnalytics(null);
      } finally {
        if (!cancelled) setAnalyticsLoading(false);
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

  const handleRequestRevision = useCallback(async () => {
    if (!selectedPost) return;
    await onPostUpdate(selectedPost.id, { status: "revision_requested" });
    setSelectedPost(null);
    onRefresh();
  }, [selectedPost, onPostUpdate, onRefresh]);

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

        {/* Drag-and-Drop Context */}
        <DragDropContext onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div className="grid grid-cols-7 border-l border-t">
            {days.map((day) => {
              const dateKey = format(day, "yyyy-MM-dd");
              const dayPosts = postsByDay.get(dateKey) ?? [];
              const isCurrentMonth = isSameMonth(day, currentMonth);
              const isToday = isSameDay(day, new Date());

              return (
                <Droppable droppableId={`day-${dateKey}`} key={dateKey}>
                  {(provided: DroppableProvided, snapshot: DroppableStateSnapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={cn(
                        "min-h-[110px] border-r border-b p-1.5 transition-colors",
                        !isCurrentMonth && "bg-muted/30 text-muted-foreground",
                        isToday && "bg-accent/20",
                        snapshot.isDraggingOver &&
                          "bg-primary/10 ring-2 ring-primary/30"
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
                        {dayPosts.map((post, index) => {
                          const platforms = getPlatformsForPost(post);
                          return (
                            <Draggable
                              key={post.id}
                              draggableId={`post-${post.id}`}
                              index={index}
                            >
                              {(provided, snapshot) => (
                                <div
                                  ref={provided.innerRef}
                                  {...provided.draggableProps}
                                  {...provided.dragHandleProps}
                                  className={cn(
                                    "bg-card border rounded-md px-2 py-1.5 cursor-pointer hover:shadow-md transition-shadow text-xs",
                                    snapshot.isDragging &&
                                      "shadow-lg ring-2 ring-primary/50 rotate-1"
                                  )}
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
                              )}
                            </Draggable>
                          );
                        })}
                        {provided.placeholder}
                      </div>
                    </div>
                  )}
                </Droppable>
              );
            })}
          </div>
        </DragDropContext>

        {/* Legend */}
        {isDragging && (
          <div className="mt-3 text-xs text-muted-foreground text-center animate-in fade-in">
            Dragging… drop onto any day cell to reschedule.
          </div>
        )}
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

                {/* Content */}
                <div>
                  <h4 className="text-sm font-medium mb-1">Content</h4>
                  <div className="text-sm text-muted-foreground bg-muted/50 rounded-md p-3 max-h-48 overflow-y-auto whitespace-pre-wrap">
                    {excerptFromContent(selectedPost.content, 2000)}
                  </div>
                </div>

                {/* Media */}
                {selectedPost.media_urls && selectedPost.media_urls.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium mb-1">Media</h4>
                    <div className="flex gap-2 flex-wrap">
                      {selectedPost.media_urls.map((url, i) => (
                        <img
                          key={i}
                          src={url}
                          alt={`Media ${i + 1}`}
                          className="size-16 object-cover rounded-md border"
                        />
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
            {(selectedPost?.status === "pending_approval" ||
              selectedPost?.status === "approved") && (
              <Button variant="outline" onClick={handleRequestRevision}>
                Request Revision
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
    </div>
  );
}