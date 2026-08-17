"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Bell, CheckCheck, Loader2 } from "lucide-react";
import { createBrowserClient } from "@supabase/ssr";
import type { NotificationKind, NotificationRow } from "@/lib/in-app-notifications";

export const KIND_META: Record<
  NotificationKind,
  { label: string; className: string }
> = {
  info: { label: "Info", className: "bg-gray-100 text-gray-700" },
  progress: { label: "Progress", className: "bg-blue-100 text-blue-700" },
  approval: { label: "Needs approval", className: "bg-amber-100 text-amber-700" },
  alert: { label: "Attention", className: "bg-red-100 text-red-700" },
};

function relativeTime(iso: string): string {
  try {
    const then = new Date(iso).getTime();
    const diffMs = Date.now() - then;
    const mins = Math.floor(diffMs / 60_000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(iso).toLocaleDateString();
  } catch {
    return "";
  }
}

function tenantIdFromCookie(): string {
  try {
    const match = document.cookie
      .split(";")
      .map((p) => p.trim())
      .find((p) => p.startsWith("x-tenant-id="));
    return match ? match.split("=")[1] : "";
  } catch {
    return "";
  }
}

// PWA app-icon badge: mirrored from the bell's unread count (setAppBadge on
// the device icon; cleared when everything is read). Best-effort — browsers
// that lack the API simply skip it.
function syncAppBadge(count: number): void {
  if (!("setAppBadge" in navigator) && !("clearAppBadge" in navigator)) return;
  try {
    if (count > 0) {
      void (navigator as Navigator & { setAppBadge?: (n: number) => Promise<void> }).setAppBadge?.(count);
    } else {
      void (navigator as Navigator & { clearAppBadge?: () => Promise<void> }).clearAppBadge?.();
    }
  } catch {
    // badge unsupported — ignore
  }
}

/**
 * Top-nav bell: listens for realtime broadcasts from background AI work
 * (plus a polling fallback), shows a red dot for unread items, and drops
 * down a list with links back to the work. "View all" opens the full
 * notifications center at /dashboard/notifications.
 */
export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [markingRead, setMarkingRead] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const realtimeRef = useRef<{ client: ReturnType<typeof createBrowserClient>; channel: ReturnType<ReturnType<typeof createBrowserClient>["channel"]> } | null>(null);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentLink = `${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`;

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications?limit=30", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as {
        notifications?: NotificationRow[];
        unread?: number;
      };
      setItems(data.notifications ?? []);
      const nextUnread = data.unread ?? 0;
      setUnread(nextUnread);
      syncAppBadge(nextUnread);
    } catch {
      // offline / first paint — leave the last known state
    } finally {
      setLoading(false);
    }
  }, []);

  // Mark the current page's notifications read the moment it's opened (not
  // just when the bell itself is clicked). Fires on mount + every navigation.
  useEffect(() => {
    if (!currentLink.startsWith("/dashboard")) return;
    void fetch("/api/notifications/read-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ link: currentLink }),
    })
      .catch(() => {})
      .then(() => load());
  }, [currentLink, load]);

  useEffect(() => {
    load();

    // Real-time: the server broadcasts on `notifications:<tenantId>` after
    // every insert, so the dot/dropdown update without a manual refresh.
    try {
      const tenantId = tenantIdFromCookie();
      if (tenantId) {
        const client = createBrowserClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
        );
        const channel = client
          .channel(`notifications:${tenantId}`)
          .on("broadcast", { event: "new" }, () => {
            void load();
          })
          .subscribe();
        realtimeRef.current = { client, channel };
      }
    } catch {
      // realtime unavailable — polling covers it
    }

    // Fallback poll so the dot stays fresh even if realtime is down.
    pollRef.current = setInterval(load, 60_000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      const rt = realtimeRef.current;
      realtimeRef.current = null;
      try {
        if (rt) void rt.client.removeChannel(rt.channel);
      } catch {
        // ignore
      }
    };
  }, [load]);

  const markAllRead = async () => {
    setMarkingRead(true);
    try {
      await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      setItems((prev) =>
        prev.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() }))
      );
      setUnread(0);
    } catch {
      // ignore — the next poll reconciles
    } finally {
      setMarkingRead(false);
    }
  };

  const markOneRead = async (id: string) => {
    setItems((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n))
    );
    setUnread((u) => Math.max(0, u - 1));
    try {
      await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [id] }),
      });
    } catch {
      // ignore — the next poll reconciles
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative flex items-center justify-center rounded-md border border-input bg-background size-8 hover:bg-muted transition-colors"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={unread > 0 ? `${unread} unread notifications` : "Notifications"}
      >
        <Bell className="size-4" />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-semibold leading-none">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute right-0 mt-1 z-50 w-80 max-w-[90vw] rounded-md border bg-popover shadow-md flex flex-col">
            <div className="flex items-center justify-between px-3 py-2 border-b">
              <span className="text-sm font-semibold">Notifications</span>
              <div className="flex items-center gap-2">
                {unread > 0 && (
                  <button
                    onClick={markAllRead}
                    disabled={markingRead}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                  >
                    {markingRead ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <CheckCheck className="size-3" />
                    )}
                    Mark all read
                  </button>
                )}
                <a
                  href="/dashboard/notifications"
                  onClick={() => setOpen(false)}
                  className="text-xs text-primary hover:underline"
                >
                  View all
                </a>
              </div>
            </div>

            <div className="max-h-96 overflow-y-auto">
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Loading…
                </div>
              ) : items.length === 0 ? (
                <div className="py-8 px-4 text-center text-sm text-muted-foreground">
                  No messages yet. The AI team will post updates here as work
                  runs in the background.
                </div>
              ) : (
                items.map((n) => {
                  const meta = KIND_META[n.kind] ?? KIND_META.info;
                  const unreadItem = !n.read_at;
                  const inner = (
                    <>
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm font-medium leading-snug">
                          {n.title}
                        </span>
                        <span
                          className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${meta.className}`}
                        >
                          {meta.label}
                        </span>
                      </div>
                      {n.body && (
                        <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                          {n.body}
                        </p>
                      )}
                      <span className="mt-1 block text-[11px] text-muted-foreground/70">
                        {relativeTime(n.created_at)}
                      </span>
                    </>
                  );
                  const rowClass = `block w-full text-left px-3 py-2 hover:bg-muted transition-colors border-b last:border-b-0 ${
                    unreadItem ? "bg-primary/5" : ""
                  }`;
                  return n.link ? (
                    <a
                      key={n.id}
                      href={n.link}
                      onClick={() => {
                        if (unreadItem) markOneRead(n.id);
                        setOpen(false);
                      }}
                      className={rowClass}
                    >
                      {inner}
                    </a>
                  ) : (
                    <div
                      key={n.id}
                      onClick={() => {
                        if (unreadItem) markOneRead(n.id);
                      }}
                      className={`${rowClass} cursor-pointer`}
                    >
                      {inner}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
