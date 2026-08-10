"use client"

import { useCallback, useMemo, useState } from "react"
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
} from "date-fns"
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import type { ClientPost } from "./page"
import { approvePost, requestRevision } from "./actions"

// ------------------------------------------------------------------
// Status badge config (matches ContentCalendar)
// ------------------------------------------------------------------
const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  draft: {
    label: "Draft",
    className: "bg-gray-100 text-gray-700",
  },
  pending_approval: {
    label: "Pending Approval",
    className: "bg-yellow-100 text-yellow-700",
  },
  approved: {
    label: "Approved",
    className: "bg-green-100 text-green-700",
  },
  revision_requested: {
    label: "Revision Requested",
    className: "bg-orange-100 text-orange-700",
  },
  scheduled: {
    label: "Scheduled",
    className: "bg-blue-100 text-blue-700",
  },
  published: {
    label: "Published",
    className: "bg-emerald-100 text-emerald-700",
  },
  failed: {
    label: "Failed",
    className: "bg-red-100 text-red-700",
  },
}

// ------------------------------------------------------------------
// Props
// ------------------------------------------------------------------
interface ClientDashboardProps {
  posts: ClientPost[]
  clientName: string
  clientId: string
}

// ------------------------------------------------------------------
// Component
// ------------------------------------------------------------------
export default function ClientDashboard({
  posts: initialPosts,
  clientName,
}: ClientDashboardProps) {
  const [posts, setPosts] = useState<ClientPost[]>(initialPosts)
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [selectedPost, setSelectedPost] = useState<ClientPost | null>(null)
  const [revisionComment, setRevisionComment] = useState("")
  const [actionLoading, setActionLoading] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  // ---- Calendar grid ----
  const days = useMemo(() => {
    const monthStart = startOfMonth(currentMonth)
    const monthEnd = endOfMonth(currentMonth)
    const calStart = startOfWeek(monthStart, { weekStartsOn: 0 })
    const calEnd = endOfWeek(monthEnd, { weekStartsOn: 0 })
    return eachDayOfInterval({ start: calStart, end: calEnd })
  }, [currentMonth])

  const postsByDay = useMemo(() => {
    const map = new Map<string, ClientPost[]>()
    for (const post of posts) {
      if (!post.scheduled_at) continue
      const dateKey = format(parseISO(post.scheduled_at), "yyyy-MM-dd")
      const existing = map.get(dateKey) ?? []
      existing.push(post)
      map.set(dateKey, existing)
    }
    return map
  }, [posts])

  // ---- Navigation ----
  const prevMonth = () => setCurrentMonth((m) => subMonths(m, 1))
  const nextMonth = () => setCurrentMonth((m) => addMonths(m, 1))
  const goToToday = () => setCurrentMonth(new Date())

  // ---- Filter pending-approval posts ----
  const pendingPosts = useMemo(
    () => posts.filter((p) => p.status === "pending_approval"),
    [posts]
  )

  // ---- Approve handler (server action) ----
  const handleApprove = useCallback(
    async (post: ClientPost) => {
      setActionLoading(true)
      setActionError(null)
      try {
        await approvePost(post.id)
        setPosts((prev) =>
          prev.map((p) => (p.id === post.id ? { ...p, status: "approved" } : p))
        )
        setSelectedPost(null)
      } catch (err) {
        setActionError(
          err instanceof Error ? err.message : "Failed to approve post"
        )
      } finally {
        setActionLoading(false)
      }
    },
    []
  )

  // ---- Request revision handler (server action) ----
  const handleRequestRevision = useCallback(
    async (post: ClientPost) => {
      if (!revisionComment.trim()) {
        setActionError("Please provide a reason for the revision request.")
        return
      }
      setActionLoading(true)
      setActionError(null)
      try {
        await requestRevision(post.id, revisionComment.trim())
        setPosts((prev) =>
          prev.map((p) =>
            p.id === post.id ? { ...p, status: "revision_requested" } : p
          )
        )
        setRevisionComment("")
        setSelectedPost(null)
      } catch (err) {
        setActionError(
          err instanceof Error ? err.message : "Failed to request revision"
        )
      } finally {
        setActionLoading(false)
      }
    },
    [revisionComment]
  )

  // ---- Open detail modal ----
  const openPostDetail = useCallback((post: ClientPost) => {
    setSelectedPost(post)
    setRevisionComment("")
    setActionError(null)
  }, [])

  return (
    <div className="space-y-8">
      {/* ---- Page header ---- */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{clientName}</h1>
        <p className="text-muted-foreground mt-1">
          Review and approve your content. Click any post for details.
        </p>
      </div>

      {/* ---- Pending approval list ---- */}
      <section>
        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
          <span className="inline-block size-2.5 rounded-full bg-yellow-400" />
          Pending Approval ({pendingPosts.length})
        </h2>

        {pendingPosts.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center border rounded-lg bg-muted/30">
            No posts waiting for your approval.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {pendingPosts.map((post) => (
              <div
                key={post.id}
                className="border rounded-lg p-4 bg-card hover:shadow-md transition-shadow cursor-pointer"
                onClick={() => openPostDetail(post)}
              >
                <div className="flex items-center gap-2 mb-2">
                  {post.platform && (
                    <span className="text-xs text-muted-foreground uppercase tracking-wide">
                      {post.platform}
                    </span>
                  )}
                  {post.scheduled_at && (
                    <span className="text-xs text-muted-foreground">
                      {format(parseISO(post.scheduled_at), "MMM d, yyyy")}
                    </span>
                  )}
                </div>
                <p className="text-sm line-clamp-3 text-foreground mb-3">
                  {post.content
                    ?.replace(/[#*_`~\[\]]/g, "")
                    .trim()
                    .slice(0, 150) ?? "No content"}
                  {post.content && post.content.length > 150 ? "…" : ""}
                </p>
                <span
                  className={cn(
                    "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium",
                    STATUS_CONFIG[post.status]?.className ??
                      "bg-gray-100 text-gray-700"
                  )}
                >
                  {STATUS_CONFIG[post.status]?.label ?? post.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ---- Simple calendar ---- */}
      <section>
        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
          <CalendarIcon className="size-5" />
          Calendar
        </h2>

        {/* Month navigation */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" onClick={prevMonth}>
              <ChevronLeft className="size-4" />
            </Button>
            <h3 className="text-lg font-semibold min-w-[160px] text-center">
              {format(currentMonth, "MMMM yyyy")}
            </h3>
            <Button variant="outline" size="icon" onClick={nextMonth}>
              <ChevronRight className="size-4" />
            </Button>
          </div>
          <Button variant="ghost" size="sm" onClick={goToToday}>
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

        {/* Calendar grid */}
        <div className="grid grid-cols-7 border-l border-t">
          {days.map((day) => {
            const dateKey = format(day, "yyyy-MM-dd")
            const dayPosts = postsByDay.get(dateKey) ?? []
            const isCurrentMonth = isSameMonth(day, currentMonth)
            const isToday = isSameDay(day, new Date())

            return (
              <div
                key={dateKey}
                className={cn(
                  "min-h-[80px] border-r border-b p-1 text-xs",
                  !isCurrentMonth && "bg-muted/30 text-muted-foreground",
                  isToday && "bg-[var(--client-primary)]/10"
                )}
              >
                <span
                  className={cn(
                    "text-[10px] font-medium inline-block px-1 py-0.5 rounded mb-0.5",
                    isToday && "bg-[var(--client-primary)] text-white"
                  )}
                >
                  {format(day, "d")}
                </span>
                {dayPosts.map((post) => (
                  <div
                    key={post.id}
                    className={cn(
                      "px-1 py-0.5 rounded cursor-pointer mb-0.5 text-[10px] truncate hover:ring-1 hover:ring-[var(--client-primary)]",
                      STATUS_CONFIG[post.status]?.className ??
                        "bg-gray-100 text-gray-700"
                    )}
                    title={post.content?.slice(0, 100) ?? "No content"}
                    onClick={() => openPostDetail(post)}
                  >
                    {post.content?.replace(/[#*_`~\[\]]/g, "").trim().slice(0, 30) ?? "—"}
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      </section>

      {/* ---- All posts table ---- */}
      <section>
        <h2 className="text-xl font-semibold mb-4">All Posts</h2>
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Date</th>
                <th className="text-left px-4 py-3 font-medium">Content</th>
                <th className="text-left px-4 py-3 font-medium">Platform</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-left px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {posts.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="text-center py-8 text-muted-foreground"
                  >
                    No posts yet.
                  </td>
                </tr>
              ) : (
                posts.map((post) => (
                  <tr
                    key={post.id}
                    className="border-t hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-4 py-3 text-xs">
                      {post.scheduled_at
                        ? format(parseISO(post.scheduled_at), "MMM d, yyyy")
                        : "—"}
                    </td>
                    <td className="px-4 py-3 max-w-[300px] truncate">
                      {post.content?.replace(/[#*_`~\[\]]/g, "").trim().slice(0, 80) ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {post.platform ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium",
                          STATUS_CONFIG[post.status]?.className ??
                            "bg-gray-100 text-gray-700"
                        )}
                      >
                        {STATUS_CONFIG[post.status]?.label ?? post.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        {post.status === "pending_approval" && (
                          <>
                            <Button
                              size="sm"
                              variant="default"
                              className="h-7 text-xs"
                              style={{
                                backgroundColor: "var(--client-primary)",
                              }}
                              onClick={(e) => {
                                e.stopPropagation()
                                void handleApprove(post)
                              }}
                              disabled={actionLoading}
                            >
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              onClick={(e) => {
                                e.stopPropagation()
                                openPostDetail(post)
                              }}
                            >
                              Revise
                            </Button>
                          </>
                        )}
                        {post.status !== "pending_approval" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs"
                            onClick={() => openPostDetail(post)}
                          >
                            View
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ---- Post Detail Dialog ---- */}
      <Dialog
        open={!!selectedPost}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedPost(null)
            setRevisionComment("")
            setActionError(null)
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Post Detail</DialogTitle>
            <DialogDescription>
              {selectedPost?.scheduled_at
                ? format(
                    parseISO(selectedPost.scheduled_at),
                    "MMMM d, yyyy"
                  )
                : "Unscheduled"}
              {selectedPost?.platform && ` · ${selectedPost.platform}`}
            </DialogDescription>
          </DialogHeader>

          {selectedPost && (
            <div className="space-y-4">
              {/* Status */}
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

              {/* Content */}
              <div>
                <h4 className="text-sm font-medium mb-1">Content</h4>
                <div className="text-sm text-muted-foreground bg-muted/50 rounded-md p-3 max-h-48 overflow-y-auto whitespace-pre-wrap">
                  {selectedPost.content ?? "No content"}
                </div>
              </div>

              {/* Media */}
              {selectedPost.media_urls &&
                selectedPost.media_urls.length > 0 && (
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

              {/* Action error */}
              {actionError && (
                <div className="bg-destructive/10 text-destructive text-sm rounded-md px-3 py-2">
                  {actionError}
                </div>
              )}

              {/* Revision comment field (shown for pending_approval or approved) */}
              {(selectedPost.status === "pending_approval" ||
                selectedPost.status === "approved") && (
                <div>
                  <label className="text-sm font-medium mb-1 block">
                    Revision feedback
                  </label>
                  <textarea
                    className="w-full rounded-md border px-3 py-2 text-sm resize-y min-h-[80px] focus:outline-none focus:ring-2 focus:ring-[var(--client-primary)]"
                    placeholder="Describe what needs to be changed…"
                    value={revisionComment}
                    onChange={(e) => setRevisionComment(e.target.value)}
                  />
                </div>
              )}
            </div>
          )}

          <DialogFooter className="gap-2">
            {selectedPost?.status === "pending_approval" && (
              <Button
                variant="default"
                style={{ backgroundColor: "var(--client-primary)" }}
                onClick={() => void handleApprove(selectedPost)}
                disabled={actionLoading}
              >
                {actionLoading ? "Processing…" : "Approve"}
              </Button>
            )}
            {(selectedPost?.status === "pending_approval" ||
              selectedPost?.status === "approved") && (
              <Button
                variant="outline"
                style={{ borderColor: "var(--client-primary)", color: "var(--client-primary)" }}
                onClick={() => void handleRequestRevision(selectedPost)}
                disabled={actionLoading}
              >
                {actionLoading ? "Processing…" : "Request Revision"}
              </Button>
            )}
            <Button
              variant="ghost"
              onClick={() => {
                setSelectedPost(null)
                setRevisionComment("")
                setActionError(null)
              }}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}