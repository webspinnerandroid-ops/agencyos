"use client";

import { useEffect, useState } from "react";
import { CalendarClock, Loader2, Clock, AlertTriangle, CheckCircle2 } from "lucide-react";
import { formatShortDate } from "@/lib/post-preview";

/**
 * Scheduled — overview of everything queued for the publish cron across the
 * workspace. The publish cron publishes a post exactly when status =
 * `scheduled` and scheduled_at <= now, so that same definition is what this
 * panel lists: upcoming slots, items due on the next pass, and anything
 * overdue (past due by more than an hour — investigate the cron).
 */

interface ScheduledItem {
  id: string;
  title: string;
  type: string;
  platform: string;
  client_id: string | null;
  scheduled_at: string;
  state: "upcoming" | "due" | "overdue";
}

interface PersistentFailure {
  id: string;
  title: string;
  retryCount: number;
  lastError: string;
  dismissed: boolean;
  dismissedReason?: string | null;
  failedSince?: string | null;
}

interface Counts {
  upcoming: number;
  due: number;
  overdue: number;
  persistentFailures: PersistentFailure[];
}

export default function ScheduledPage() {
  const [items, setItems] = useState<ScheduledItem[]>([]);
  const [counts, setCounts] = useState<Counts>({
    upcoming: 0,
    due: 0,
    overdue: 0,
    persistentFailures: [],
  });
  // In-flight resolve action per post (spinner on the clicked button).
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/scheduled", { credentials: "include" });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error ?? "Failed to load the scheduled queue.");
          setItems([]);
        } else {
          setError(null);
          setItems(data.items ?? []);
          setCounts({
            upcoming: data.upcoming ?? 0,
            due: data.due ?? 0,
            overdue: data.overdue ?? 0,
            persistentFailures: data.persistentFailures ?? [],
          });
        }
      } catch {
        if (!cancelled) setError("Network error loading the scheduled queue.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const t = setInterval(load, 30000); // light refresh while the tab is open
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

  /** Retry now / Dismiss on a persistent failure. Reloads after the call. */
  const resolve = async (
    postId: string,
    action: "retry" | "dismiss",
    reason?: string
  ) => {
    if (action === "dismiss") {
      const input = prompt(
        "Why are you dismissing this failure? (shown on the panel row)"
      );
      if (input === null) return; // cancelled
      if (!input.trim()) {
        alert("A reason is required to dismiss a failure.");
        return;
      }
      reason = input.trim();
    }
    setResolvingId(postId);
    try {
      const res = await fetch("/api/scheduled/resolve", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId, action, reason }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error ?? "Could not resolve the failure.");
        return;
      }
    } catch {
      alert("Network error. Please try again.");
      return;
    } finally {
      setResolvingId(null);
    }
    // Refresh the panel immediately (the interval would catch it in ≤30s).
    try {
      const res = await fetch("/api/scheduled", { credentials: "include" });
      const data = await res.json();
      if (res.ok) {
        setItems(data.items ?? []);
        setCounts({
          upcoming: data.upcoming ?? 0,
          due: data.due ?? 0,
          overdue: data.overdue ?? 0,
          persistentFailures: data.persistentFailures ?? [],
        });
      }
    } catch {
      // next interval refresh will catch it
    }
  };

  const groups: { key: ScheduledItem["state"]; label: string; icon: typeof Clock; tone: string }[] = [
    { key: "overdue", label: "Overdue (past due > 1h — investigate the publish cron)", icon: AlertTriangle, tone: "text-red-600" },
    { key: "due", label: "Due now (next cron pass publishes these)", icon: Clock, tone: "text-amber-600" },
    { key: "upcoming", label: "Upcoming", icon: CheckCircle2, tone: "text-blue-600" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Scheduled</h1>
          <p className="text-muted-foreground mt-1">
            Everything queued for the publish cron in this workspace — {counts.upcoming} upcoming,{" "}
            {counts.due} due, {counts.overdue} overdue.
            {counts.persistentFailures.length > 0 && (
              <span className="text-destructive"> {counts.persistentFailures.length} need attention.</span>
            )}
          </p>
        </div>
        {loading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {!loading && !error && items.length === 0 && (
        <div className="rounded-lg border bg-card p-12 text-center text-muted-foreground">
          <CalendarClock className="size-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">
            Nothing scheduled yet. Schedule drafts from Posts, or let the Content Map's
            auto-publish place them here.
          </p>
        </div>
      )}

      {/* Persistent publish failures — the retry ladder gave up on these
          (3 automatic retries over ~2.5h); a human needs to look. */}
      {counts.persistentFailures.length > 0 && (
        <div className="space-y-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-destructive">
            <AlertTriangle className="size-4" /> Failed — automatic retries exhausted —{" "}
            {counts.persistentFailures.filter((f) => !f.dismissed).length}
          </h2>
          <div className="rounded-lg border border-destructive/30 divide-y bg-card">
            {counts.persistentFailures.map((f) => (
              <div
                key={f.id}
                className={`p-4 ${f.dismissed ? "opacity-60" : ""}`}
              >
                <div className="flex items-center justify-between gap-4">
                  <a
                    href={`/dashboard/posts?post=${f.id}`}
                    className="text-sm font-medium truncate hover:underline"
                  >
                    {f.title}
                  </a>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {f.retryCount} automatic retry{f.retryCount === 1 ? "" : "s"}
                    {f.failedSince ? ` · since ${formatShortDate(f.failedSince)}` : ""}
                  </span>
                </div>
                <p className="text-xs text-destructive mt-1 truncate" title={f.lastError}>
                  Last error: {f.lastError}
                </p>
                {f.dismissedReason && (
                  <p className="text-xs text-muted-foreground mt-1 italic" title={f.dismissedReason}>
                    Dismissed: {f.dismissedReason}
                  </p>
                )}
                <div className="flex items-center gap-2 mt-2">
                  <button
                    onClick={() => resolve(f.id, "retry")}
                    disabled={resolvingId === f.id}
                    className="px-2 py-1 text-xs rounded-md border border-primary/30 text-primary hover:bg-primary/10 disabled:opacity-50"
                  >
                    {resolvingId === f.id ? "Working…" : "Retry now"}
                  </button>
                  <button
                    onClick={() => resolve(f.id, "dismiss")}
                    disabled={resolvingId === f.id}
                    className="px-2 py-1 text-xs rounded-md border text-muted-foreground hover:bg-muted disabled:opacity-50"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {groups.map(({ key, label, icon: Icon, tone }) => {
        const group = items.filter((i) => i.state === key);
        if (group.length === 0) return null;
        return (
          <div key={key} className="space-y-2">
            <h2 className={`flex items-center gap-2 text-sm font-semibold ${tone}`}>
              <Icon className="size-4" /> {label} — {group.length}
            </h2>
            <div className="rounded-lg border divide-y bg-card">
              {group.map((item) => (
                <a
                  key={item.id}
                  href={`/dashboard/posts?post=${item.id}`}
                  className="flex items-center justify-between p-4 hover:bg-muted/30 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{item.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      <span className="capitalize">{item.type}</span>
                      {item.platform ? ` • ${item.platform}` : ""}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {fmt(item.scheduled_at)}
                  </span>
                </a>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
