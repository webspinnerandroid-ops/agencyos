"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ContentCalendar, {
  type CalendarPost,
  type PostStatus,
  type ProposedItem,
} from "@/components/ContentCalendar";
import { CalendarRange, Map, Sparkles, Loader2 } from "lucide-react";

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

interface Client {
  id: string;
  name: string;
}

interface CampaignPlan {
  id: string;
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
      const now = new Date();
      const startDate = new Date(
        now.getFullYear(),
        now.getMonth() - 1,
        1
      ).toISOString();
      const endDate = new Date(
        now.getFullYear(),
        now.getMonth() + 2,
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

      {/* Campaign plans from the AI team — the proposed side of the calendar */}
      {campaignPlans.length > 0 && (
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <Map className="size-4 text-primary" />
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

      {loading && posts.length === 0 ? (
        <div className="flex items-center justify-center py-24 text-muted-foreground">
          <div className="animate-spin rounded-full size-8 border-2 border-primary border-t-transparent mr-3" />
          Loading posts…
        </div>
      ) : (
        <ContentCalendar
          posts={posts}
          proposedItems={proposedItems}
          clients={clients}
          selectedClientId={selectedClientId}
          selectedStatuses={selectedStatuses}
          onClientChange={setSelectedClientId}
          onStatusesChange={setSelectedStatuses}
          onPostUpdate={handlePostUpdate}
          onApproveProposed={handleApproveProposed}
          onRefresh={handleRefresh}
        />
      )}
    </div>
  );
}