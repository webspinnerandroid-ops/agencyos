"use client";

import { useCallback, useEffect, useState } from "react";
import ContentCalendar, {
  type CalendarPost,
  type PostStatus,
} from "@/components/ContentCalendar";

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

interface Client {
  id: string;
  name: string;
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
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [selectedStatuses, setSelectedStatuses] =
    useState<PostStatus[]>(DEFAULT_STATUSES);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  // ---- Reschedule handler ----
  const handlePostReschedule = useCallback(
    async (postId: string, newDate: string) => {
      const newScheduledAt = new Date(newDate).toISOString();
      await fetch(`/api/posts/${postId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduled_at: newScheduledAt }),
      });
    },
    []
  );

  // ---- Post update (status changes from modal) ----
  const handlePostUpdate = useCallback(
    async (postId: string, data: Partial<Pick<CalendarPost, "status">>) => {
      await fetch(`/api/posts/${postId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
    },
    []
  );

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
          Drag and drop posts to reschedule. Click a post to view details.
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

      {loading && posts.length === 0 ? (
        <div className="flex items-center justify-center py-24 text-muted-foreground">
          <div className="animate-spin rounded-full size-8 border-2 border-primary border-t-transparent mr-3" />
          Loading posts…
        </div>
      ) : (
        <ContentCalendar
          posts={posts}
          clients={clients}
          selectedClientId={selectedClientId}
          selectedStatuses={selectedStatuses}
          onClientChange={setSelectedClientId}
          onStatusesChange={setSelectedStatuses}
          onPostReschedule={handlePostReschedule}
          onPostUpdate={handlePostUpdate}
          onRefresh={handleRefresh}
        />
      )}
    </div>
  );
}