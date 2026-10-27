"use client";

import ContentCalendar, {
  type CalendarPost,
  type PostStatus,
  type ProposedItem,
} from "@/components/ContentCalendar";
import { CalendarRange, Map as MapIcon, Sparkles, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

interface Client {
  id: string;
  name: string;
}

interface CampaignPlan {
  id: string;
  tenant_id: string;
  /** The client the plan maps out — null is a tenant-wide, cross-client plan. */
  client_id: string | null;
  title: string;
  summary: string;
  status: string;
  created_at: string;
  items: {
    id: string;
    kind: "blog" | "social";
    topic: string;
    due_date: string;
    platform: string | null;
    owner: string | null;
    status: string;
    linked_post_id: string | null;
    keywords: string[] | null;
    internal_link: string | null;
    external_links: string[] | null;
  }[];
}

/**
 * Best-effort title for the undo banner. Post list rows carry the small JSON
 * keys as `content` (object or serialized JSON string) — `title` when present,
 * else a raw excerpt, else "Untitled post".
 */
function contentTitleFrom(post: CalendarPost): string {
  const raw = post.content;
  let content: Record<string, unknown> | null = null;
  if (typeof raw === "object" && raw !== null) {
    content = raw as Record<string, unknown>;
  } else if (typeof raw === "string" && raw.trim()) {
    try {
      content = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      content = null;
    }
  }
  const title =
    typeof content?.title === "string" && content.title.trim()
      ? content.title.trim()
      : null;
  if (title) return title;
  const caption =
    typeof content?.caption === "string" && content.caption.trim()
      ? content.caption.trim()
      : null;
  return caption ?? "Untitled post";
}

const DEFAULT_STATUSES: PostStatus[] = [
  "draft",
  "pending_approval",
  "approved",
  "revision_requested",
  "scheduled",
  "published",
  "failed",
];

// ------------------------------------------------------------------
// Page
// ------------------------------------------------------------------

export default function CalendarPage() {
  const [posts, setPosts] = useState<CalendarPost[]>([]);
  // Posts with no scheduled_at — the "Unscheduled backlog" strip's source
  // list. Kept separate from `posts` (which is a date-windowed query) so the
  // drag-to-schedule move is a transfer between the two lists.
  const [unscheduledPosts, setUnscheduledPosts] = useState<CalendarPost[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [campaignPlans, setCampaignPlans] = useState<CampaignPlan[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [selectedStatuses, setSelectedStatuses] =
    useState<PostStatus[]>(DEFAULT_STATUSES);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refiningPlanId, setRefiningPlanId] = useState<string | null>(null);
  const [refineNote, setRefineNote] = useState<string | null>(null);

  // ---- Campaign plans (proposed items from the AI team) ----
  const fetchCampaignPlans = useCallback(async () => {
    try {
      const res = await fetch("/api/campaign-plans", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setCampaignPlans(data.plans ?? []);
      }
    } catch {
      // calendar still works without plans
    }
  }, []);

  useEffect(() => {
    fetchCampaignPlans();
  }, [fetchCampaignPlans]);

  // Highlight the plan deep-linked from the chat (?plan=<id>).
  const focusedPlanId = useMemo(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("plan");
  }, []);

  // Flatten plan items into the calendar's ProposedItem shape.
  const proposedItems: ProposedItem[] = useMemo(() => {
    const out: ProposedItem[] = [];
    for (const plan of campaignPlans) {
      for (const item of plan.items ?? []) {
        // Only un-approved items render as dashed "proposed" chips — once
        // approved the item is represented by its linked draft post.
        if (item.status !== "proposed") continue;
        out.push({
          id: item.id,
          date: item.due_date,
          title: item.topic,
          kind: item.kind,
          planId: plan.id,
          planTitle: plan.title,
          // The plan's client drives the calendar's client filter: proposals
          // for other clients must not render on a client-scoped view.
          // (campaign_plans.client_id is still null for cross-client plans.)
          clientId: plan.client_id ?? null,
          platform: item.platform,
          owner: item.owner,
          keywords: item.keywords,
          internalLink: item.internal_link,
          externalLinks: item.external_links,
        });
      }
    }
    return out;
  }, [campaignPlans]);

  // ---- Fetch clients ----
  const fetchClients = useCallback(async () => {
    try {
      const res = await fetch("/api/clients", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setClients(data.clients ?? []);
      }
    } catch {
      // Silently fail
    }
  }, []);

  useEffect(() => {
    fetchClients();
  }, [fetchClients]);

  // ---- Fetch posts ----
  const fetchPosts = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();

      // Determine date range for the current view — fetch a generous window
      // (full month + buffer). The component handles the current month,
      // but we fetch a wider range so navigation feels instant for a while.
      // Last day of month+2 (two FULL months ahead): the auto-jump reads
      // this list to find the next non-empty month, so a post scheduled
      // late in month+2 must be inside it.
      const now = new Date();
      const startDate = new Date(
        now.getFullYear(),
        now.getMonth() - 1,
        1
      ).toISOString();
      const endDate = new Date(
        now.getFullYear(),
        now.getMonth() + 3,
        0
      ).toISOString();

      params.set("startDate", startDate);
      params.set("endDate", endDate);

      if (selectedClientId) {
        params.set("clientId", selectedClientId);
      }

      // Status filter: if none selected, don't filter (show all);
      // if all selected, same; otherwise filter to selected.
      if (
        selectedStatuses.length > 0 &&
        selectedStatuses.length < DEFAULT_STATUSES.length
      ) {
        // The API only supports single status at a time via query param,
        // so we fetch all and filter client-side. We'll pass no status
        // filter to the API and do the filtering here.
      }

      const res = await fetch(`/api/posts?${params.toString()}`, { credentials: "include" });
      if (!res.ok) {
        const errData = await res.json();
        setError(errData.error ?? "Failed to fetch posts");
        setPosts([]);
        return;
      }

      const data = await res.json();
      let fetchedPosts: CalendarPost[] = data.posts ?? [];

      // Client-side status filtering
      if (
        selectedStatuses.length > 0 &&
        selectedStatuses.length < DEFAULT_STATUSES.length
      ) {
        fetchedPosts = fetchedPosts.filter((p) =>
          selectedStatuses.includes(p.status)
        );
      }

      setPosts(fetchedPosts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error");
      setPosts([]);
    } finally {
      setLoading(false);
    }
  }, [selectedClientId, selectedStatuses]);

  useEffect(() => {
    fetchPosts();
  }, [fetchPosts]);

  // ---- Fetch undated posts (backlog strip) ----
  // GET /api/posts?unscheduled=1 ignores the date window and returns up to
  // 50 posts with scheduled_at IS NULL, newest first. Re-fetched on client
  // switch and after every schedule/unschedule, exactly like the grid list.
  const fetchUnscheduled = useCallback(async () => {
    try {
      const params = new URLSearchParams({ unscheduled: "1" });
      if (selectedClientId) params.set("clientId", selectedClientId);
      const res = await fetch(`/api/posts?${params.toString()}`, {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setUnscheduledPosts(data.posts ?? []);
      } else {
        setUnscheduledPosts([]);
      }
    } catch {
      setUnscheduledPosts([]); // the strip degrades quietly to empty
    }
  }, [selectedClientId]);

  useEffect(() => {
    fetchUnscheduled();
  }, [fetchUnscheduled]);

  // ---- Post update (status changes from modal) ----
  const handlePostUpdate = useCallback(
    async (
      postId: string,
      data: Partial<Pick<CalendarPost, "status" | "revision_reason">>
    ) => {
      await fetch(`/api/posts/${postId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
    },
    []
  );

  // ---- Drag-to-reschedule (calendar grid drop) ----
  // The component computes the new UTC instant (same local wall-clock time,
  // offset resolved for the TARGET date so a drop across a DST boundary keeps
  // the same wall time). Optimistically move the chip; a failed PATCH is
  // reverted by refetching the authoritative list.
  const postsRef = useRef<CalendarPost[]>([]);
  useEffect(() => {
    postsRef.current = posts;
  }, [posts]);

  const unscheduledPostsRef = useRef<CalendarPost[]>([]);
  useEffect(() => {
    unscheduledPostsRef.current = unscheduledPosts;
  }, [unscheduledPosts]);

  // Double-drop protection, two layers:
  //   1. Per-post move serialization — reschedule PATCHes for one post are
  //      queued behind each other, so a rapid re-drop cannot have its earlier,
  //      slower PATCH land after the later one and strand the row at the
  //      older instant while the UI shows the newer day.
  //   2. Duplicate-target guard — while a move is still being written, an
  //      identical (postId, target) drop is a stray repeat, not a decision.
  // A completed move can always be repeated (e.g. after a failed PATCH).
  const moveQueuesRef = useRef<Map<string, Promise<void>>>(new Map());
  const moveInFlightRef = useRef<Map<string, string>>(new Map());

  const performMove = useCallback(
    async (postId: string, newScheduledAt: string): Promise<boolean> => {
      try {
        const res = await fetch(`/api/posts/${postId}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scheduled_at: newScheduledAt }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => null);
          console.error(
            "[calendar] reschedule failed:",
            (err as { error?: string })?.error ?? res.status
          );
          await fetchPosts(); // revert optimistic move
          return false;
        }
        // Re-assert the applied instant: an interleaved refetch (sibling
        // failure or cleanup poll) must not repaint an older date.
        setPosts((prev) =>
          prev.map((p) =>
            p.id === postId ? { ...p, scheduled_at: newScheduledAt } : p
          )
        );
        return true;
      } catch {
        await fetchPosts(); // network failure — revert
        return false;
      }
    },
    [fetchPosts]
  );

  const handlePostMove = useCallback(
    (postId: string, newScheduledAt: string, options?: { silent?: boolean }) => {
      if (moveInFlightRef.current.get(postId) === newScheduledAt) {
        return Promise.resolve(); // duplicate drop of the move already in flight
      }
      const post = postsRef.current.find((p) => p.id === postId);
      const previousScheduledAt = post?.scheduled_at ?? null;
      if (!previousScheduledAt || !post) return Promise.resolve();

      // Guard and the optimistic jump are set at ENQUEUE time (drop order).
      // The serial queue only orders the WRITE, per the comment below: a
      // queued reverse move must show immediately and dedupe subsequent
      // identical drops. Setting the guard inside the chained body instead
      // let rapid re-drops while a write is in flight enqueue a duplicate
      // PATCH for every retry (each saw the stale guard).
      moveInFlightRef.current.set(postId, newScheduledAt);
      setPosts((prev) =>
        prev.map((p) =>
          p.id === postId ? { ...p, scheduled_at: newScheduledAt } : p
        )
      );

      const queue = (
        moveQueuesRef.current.get(postId) ?? Promise.resolve()
      ).catch(() => {});
      const next = queue.then(async () => {
        const ok = await performMove(postId, newScheduledAt);
        if (ok) {
          if (!options?.silent) {
            setUndoMove({
              kind: "move",
              postId,
              previousScheduledAt,
              movedToIso: newScheduledAt,
              title: contentTitleFrom(post),
            });
          }
        } else {
          setUndoMove(null); // a failed drop has nothing to undo
        }
      });
      moveQueuesRef.current.set(
        postId,
        next.finally(() => {
          if (moveInFlightRef.current.get(postId) === newScheduledAt) {
            moveInFlightRef.current.delete(postId);
          }
        })
      );
      return next;
    },
    [performMove]
  );

  // ---- Backlog scheduling (backlog chip dropped on a day) ----
  // The drop assigns the target day's 9:00 AM local slot (computed in the
  // component). Optimistic: the chip leaves the backlog strip immediately
  // and joins the grid on the target day when that day is in view. Same
  // duplicate-target guard as moves; a failed PATCH reverts by refetching
  // both authoritative lists. scheduled_at-only PATCHes do not change the
  // status, so the approval gate is untouched and nothing self-publishes.
  const handlePostSchedule = useCallback(
    async (postId: string, newScheduledAt: string) => {
      if (moveInFlightRef.current.get(postId) === newScheduledAt) {
        return; // duplicate drop of a move already in flight
      }
      const post = unscheduledPostsRef.current.find((p) => p.id === postId);
      if (!post) return;
      moveInFlightRef.current.set(postId, newScheduledAt);
      setUnscheduledPosts((prev) => prev.filter((p) => p.id !== postId));
      setPosts((prev) =>
        prev.some((p) => p.id === postId)
          ? prev
          : [...prev, { ...post, scheduled_at: newScheduledAt }]
      );
      let ok = false;
      try {
        const res = await fetch(`/api/posts/${postId}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scheduled_at: newScheduledAt }),
        });
        ok = res.ok;
        if (!res.ok) {
          const err = await res.json().catch(() => null);
          console.error(
            "[calendar] schedule failed:",
            (err as { error?: string })?.error ?? res.status
          );
        }
      } catch (err) {
        console.error("[calendar] schedule network failure:", err);
      }
      moveInFlightRef.current.delete(postId);
      if (ok) {
        setUndoMove({
          kind: "schedule",
          postId,
          previousScheduledAt: null,
          movedToIso: newScheduledAt,
          title: contentTitleFrom(post),
        });
      } else {
        setUndoMove(null); // a failed drop has nothing to undo
        await Promise.all([fetchPosts(), fetchUnscheduled()]);
      }
    },
    [fetchPosts, fetchUnscheduled]
  );

  // ---- Undo after a wrong drop ----
  // The last successful move is offered back for a few seconds. A move's
  // undo restores the exact previous UTC instant verbatim (no offset
  // recomputation, so a DST-crossing undo is safe by construction).
  //
  // Undoing a BACKLOG SCHEDULING is different: there was no previous slot —
  // the chip returns to the backlog by patching scheduled_at back to null
  // (the update schema's "null = unschedule") and refetching both lists.
  const [undoMove, setUndoMove] = useState<
    | {
        kind: "move";
        postId: string;
        previousScheduledAt: string;
        movedToIso: string;
        title: string;
      }
    | {
        kind: "schedule";
        postId: string;
        previousScheduledAt: null;
        movedToIso: string;
        title: string;
      }
    | null
  >(null);

  useEffect(() => {
    if (!undoMove) return;
    const t = setTimeout(() => setUndoMove(null), 8_000);
    return () => clearTimeout(t);
  }, [undoMove]);

  const handleUndoMove = useCallback(async () => {
    const notice = undoMove;
    if (!notice) return;
    setUndoMove(null);
    if (notice.kind === "schedule") {
      const res = await fetch(`/api/posts/${notice.postId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduled_at: null }),
      });
      if (!res.ok) {
        console.error("[calendar] unschedule (undo) failed:", res.status);
      }
      await Promise.all([fetchPosts(), fetchUnscheduled()]);
      return;
    }
    await handlePostMove(notice.postId, notice.previousScheduledAt, {
      silent: true,
    });
    // setUndoMove: the compiler infers it from the calls above; being a
    // setState setter it is stable, but the memoization pass requires the
    // inferred dependency set to match this array exactly.
  }, [undoMove, handlePostMove, fetchPosts, fetchUnscheduled, setUndoMove]);

  // ---- Approve a proposed campaign item (creates a draft post) ----
  const handleApproveProposed = useCallback(
    async (item: ProposedItem, mediaKind: "image" | "video" = "image") => {
      const res = await fetch("/api/campaign-plans", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: item.id, mediaKind }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? "Failed to approve item");
      }
      await Promise.all([fetchCampaignPlans(), fetchPosts()]);
    },
    [fetchCampaignPlans, fetchPosts]
  );

  // ---- Refine with Malory: one cheap call that polishes the plan ----
  const handleRefinePlan = useCallback(
    async (planId: string) => {
      setRefiningPlanId(planId);
      setRefineNote(null);
      try {
        const res = await fetch("/api/campaign-plans/refine", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ planId }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error ?? "Refine failed");
          return;
        }
        setRefineNote(data.note ?? "Malory refined the plan.");
        await fetchCampaignPlans();
      } catch {
        setError("Network error while refining");
      } finally {
        setRefiningPlanId(null);
      }
    },
    [fetchCampaignPlans]
  );

  // While any campaign item is "draft" (content generating after idea
  // approval), poll so the generated post appears the moment it's ready.
  const anyGenerating = useMemo(
    () =>
      campaignPlans.some((plan) =>
        (plan.items ?? []).some((i) => i.status === "draft")
      ),
    [campaignPlans]
  );
  useEffect(() => {
    if (!anyGenerating) return;
    const iv = setInterval(() => {
      fetchCampaignPlans();
      fetchPosts();
    }, 8000);
    return () => clearInterval(iv);
  }, [anyGenerating, fetchCampaignPlans, fetchPosts]);

  // ---- Refresh after mutations ----
  const handleRefresh = useCallback(() => {
    fetchPosts();
  }, [fetchPosts]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          Content Calendar
        </h1>
        <p className="text-muted-foreground mt-1">
          Click a post to view details.
        </p>
      </div>

      {error && (
        <div className="bg-destructive/10 text-destructive text-sm rounded-md px-4 py-3">
          {error}
          <button
            className="underline ml-2"
            onClick={handleRefresh}
          >
            Retry
          </button>
        </div>
      )}

      {undoMove && (
        <div
          role="status"
          aria-live="polite"
          data-testid="post-move-undo"
          className="flex items-center gap-3 rounded-md border bg-card px-4 py-3 text-sm"
        >
          <span className="text-muted-foreground">
            {undoMove.kind === "schedule" ? "Scheduled" : "Moved"}{" "}
            <span className="font-medium text-foreground">
              “{undoMove.title}”
            </span>{" "}
            {undoMove.kind === "schedule" ? "for" : "to"}{" "}
            {new Date(undoMove.movedToIso).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })}
            .
          </span>
          <button
            type="button"
            onClick={() => void handleUndoMove()}
            className="rounded-md border border-primary/40 px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
          >
            Undo
          </button>
        </div>
      )}

      {/* Campaign plans from the AI team — the proposed side of the calendar */}
      {campaignPlans.length > 0 && (
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <MapIcon className="size-4 text-primary" />
            <h2 className="font-semibold">Campaign plans</h2>
            <span className="text-xs text-muted-foreground">
              Mapped out by the AI team — proposed pieces appear on the calendar as dashed entries
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {campaignPlans.map((plan) => {
              const blogCount =
                plan.items?.filter((i) => i.kind === "blog").length ?? 0;
              const socialCount =
                plan.items?.filter((i) => i.kind === "social").length ?? 0;
              const focused = plan.id === focusedPlanId;
              return (
                <div
                  key={plan.id}
                  className={`rounded-lg border p-3 text-sm ${
                    focused
                      ? "border-primary ring-2 ring-primary/40"
                      : "bg-muted/30"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <CalendarRange className="size-4 text-primary shrink-0" />
                    <span className="font-medium truncate">{plan.title}</span>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
                    {plan.summary || "No summary"}
                  </p>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300 rounded-full px-2 py-0.5">
                      {plan.status}
                    </span>
                    <span className="text-muted-foreground">
                      {blogCount} blogs · {socialCount} socials
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled={refiningPlanId !== null}
                    onClick={() => handleRefinePlan(plan.id)}
                    className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-medium text-primary border border-primary/30 rounded-md px-2 py-1 hover:bg-primary/10 disabled:opacity-50 transition-colors"
                    title="One cheap call — Malory tightens titles, dates and spacing while keeping the agreed scope."
                  >
                    {refiningPlanId === plan.id ? (
                      <>
                        <Loader2 className="size-3 animate-spin" />
                        Malory is refining…
                      </>
                    ) : (
                      <>
                        <Sparkles className="size-3" />
                        Refine with Malory
                      </>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Skeleton staging: always render the real calendar — during the
          first load the grid shows skeleton pills per day (see the
          component) instead of a blank spinner screen. */}
      <ContentCalendar
        posts={posts}
        proposedItems={proposedItems}
        clients={clients}
        selectedClientId={selectedClientId}
        selectedStatuses={selectedStatuses}
        onClientChange={setSelectedClientId}
        onStatusesChange={setSelectedStatuses}
        onPostUpdate={handlePostUpdate}
        onPostMove={handlePostMove}
        onPostSchedule={handlePostSchedule}
        unscheduledPosts={unscheduledPosts}
        onApproveProposed={handleApproveProposed}
        onRefresh={handleRefresh}
        loadingFirst={loading && posts.length === 0}
      />
    </div>
  );
}