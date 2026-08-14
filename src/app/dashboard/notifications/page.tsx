"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bell,
  CheckCheck,
  Trash2,
  Loader2,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { KIND_META } from "@/components/NotificationBell";
import type { NotificationKind, NotificationRow } from "@/lib/in-app-notifications";

const PAGE_SIZE = 20;
const FILTERS: { key: NotificationKind | null; label: string }[] = [
  { key: null, label: "All" },
  { key: "info", label: "Info" },
  { key: "progress", label: "Progress" },
  { key: "approval", label: "Needs approval" },
  { key: "alert", label: "Attention" },
];

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
    return new Date(iso).toLocaleString();
  } catch {
    return "";
  }
}

interface Group {
  key: string;
  items: NotificationRow[];
}

export default function NotificationsCenterPage() {
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [total, setTotal] = useState(0);
  const [unread, setUnread] = useState(0);
  const [unreadByKind, setUnreadByKind] = useState<Record<NotificationKind, number>>({
    info: 0,
    progress: 0,
    approval: 0,
    alert: 0,
  });
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState<NotificationKind | null>(null);
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });
      if (kind) params.set("kind", kind);
      const res = await fetch(`/api/notifications?${params}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as {
        notifications: NotificationRow[];
        total: number;
        unread: number;
        unreadByKind: Record<NotificationKind, number>;
      };
      setItems(data.notifications ?? []);
      setTotal(data.total ?? 0);
      setUnread(data.unread ?? 0);
      setUnreadByKind(
        data.unreadByKind ?? { info: 0, progress: 0, approval: 0, alert: 0 }
      );
      setSelected(new Set());
      setExpanded(new Set());
    } catch {
      // leave last state
    } finally {
      setLoading(false);
    }
  }, [kind, offset]);

  useEffect(() => {
    load();
  }, [load]);

  // Group the page's notifications by their group_key (chat/task), collapsing
  // a burst of updates about one piece of work into a single entry.
  const groups = useMemo<Group[]>(() => {
    const byKey = new Map<string, NotificationRow[]>();
    for (const n of items) {
      const key = n.group_key ?? `id:${n.id}`;
      const list = byKey.get(key);
      if (list) list.push(n);
      else byKey.set(key, [n]);
    }
    return [...byKey.entries()].map(([key, list]) => ({ key, items: list }));
  }, [items]);

  const allIds = useMemo(() => items.map((i) => i.id), [items]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleGroup = (group: Group) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const ids = group.items.map((i) => i.id);
      const allOn = ids.every((id) => next.has(id));
      for (const id of ids) {
        if (allOn) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) =>
      prev.size === allIds.length ? new Set() : new Set(allIds)
    );
  };

  const toggleExpanded = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const markSelectedRead = async () => {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selected] }),
      });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const markAllRead = async () => {
    setBusy(true);
    try {
      await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const deleteSelected = async () => {
    if (selected.size === 0) return;
    if (!window.confirm(`Delete ${selected.size} notification(s)?`)) return;
    setBusy(true);
    try {
      await fetch("/api/notifications", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selected] }),
      });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const markOneRead = (id: string) => {
    void fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [id] }),
    });
  };

  const renderItem = (n: NotificationRow, showCheckbox: boolean) => {
    const meta = KIND_META[n.kind] ?? KIND_META.info;
    const unreadItem = !n.read_at;
    return (
      <div className="flex items-start gap-3 py-2.5 px-3">
        {showCheckbox && (
          <input
            type="checkbox"
            checked={selected.has(n.id)}
            onChange={() => toggle(n.id)}
            className="mt-1 size-4 shrink-0"
            onClick={(e) => e.stopPropagation()}
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <span
              className={`text-sm font-medium leading-snug ${
                unreadItem ? "text-foreground" : "text-muted-foreground"
              }`}
            >
              {n.title}
            </span>
            <span
              className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${meta.className}`}
            >
              {meta.label}
            </span>
          </div>
          {n.body && (
            <p className="mt-0.5 text-xs text-muted-foreground">{n.body}</p>
          )}
          <span className="mt-1 block text-[11px] text-muted-foreground/70">
            {relativeTime(n.created_at)}
            {unreadItem && (
              <span className="ml-2 inline-flex size-1.5 rounded-full bg-red-500 align-middle" />
            )}
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Bell className="size-6 text-primary" /> Notifications
          </h1>
          <p className="text-muted-foreground">
            Updates from the AI team: background work, scheduled publishes, and
            things waiting on your approval.
            {unread > 0 && (
              <span className="ml-2 inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                {unread} unread
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={markAllRead}
            disabled={busy || unread === 0}
            className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50 transition-colors"
          >
            <CheckCheck className="size-4" /> Mark all read
          </button>
        </div>
      </div>

      {/* Kind filters with per-kind unread counts */}
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => {
          const count = f.key === null ? unread : unreadByKind[f.key];
          return (
            <button
              key={f.key ?? "all"}
              onClick={() => {
                setOffset(0);
                setKind(f.key);
              }}
              className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                kind === f.key
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background border-input hover:bg-muted"
              }`}
            >
              {f.label}
              {count > 0 && (
                <span
                  className={`ml-1.5 rounded-full px-1.5 text-xs font-semibold ${
                    kind === f.key
                      ? "bg-primary-foreground/20 text-primary-foreground"
                      : "bg-red-100 text-red-700"
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Bulk actions */}
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={allIds.length > 0 && selected.size === allIds.length}
            onChange={toggleAll}
            className="size-4"
          />
          Select page ({selected.size} selected)
        </label>
        <button
          onClick={markSelectedRead}
          disabled={busy || selected.size === 0}
          className="inline-flex items-center gap-1 rounded-md border border-input bg-background px-2.5 py-1 text-xs hover:bg-muted disabled:opacity-50 transition-colors"
        >
          <CheckCheck className="size-3.5" /> Mark read
        </button>
        <button
          onClick={deleteSelected}
          disabled={busy || selected.size === 0}
          className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-background px-2.5 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors"
        >
          <Trash2 className="size-3.5" /> Delete
        </button>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center gap-2 py-10 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading notifications…
        </div>
      ) : items.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground border rounded-lg">
          No notifications{kind ? ` of type “${KIND_META[kind].label}”` : ""} yet.
        </div>
      ) : (
        <div className="rounded-lg border divide-y">
          {groups.map((group) => {
            const latest = group.items[0];
            const meta = KIND_META[latest.kind] ?? KIND_META.info;
            const unreadInGroup = group.items.filter((i) => !i.read_at).length;
            const isExpanded = expanded.has(group.key);

            // Single-item group → render flat.
            if (group.items.length === 1) {
              const n = group.items[0];
              const row = (
                <div className="hover:bg-muted/50 transition-colors">
                  {renderItem(n, true)}
                </div>
              );
              return n.link ? (
                <a
                  key={group.key}
                  href={n.link}
                  onClick={() => {
                    if (!n.read_at) markOneRead(n.id);
                  }}
                  className="block"
                >
                  {row}
                </a>
              ) : (
                <div key={group.key}>{row}</div>
              );
            }

            // Multi-item group → collapsible header with a count.
            const groupIds = group.items.map((i) => i.id);
            const allOn = groupIds.every((id) => selected.has(id));
            return (
              <div key={group.key}>
                <div
                  className="flex items-center gap-3 py-3 px-4 cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => toggleExpanded(group.key)}
                >
                  <input
                    type="checkbox"
                    checked={allOn}
                    onChange={() => toggleGroup(group)}
                    className="size-4 shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-sm font-medium leading-snug truncate ${
                          unreadInGroup > 0
                            ? "text-foreground"
                            : "text-muted-foreground"
                        }`}
                      >
                        {latest.title}
                      </span>
                      <span
                        className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${meta.className}`}
                      >
                        {meta.label}
                      </span>
                    </div>
                    <span className="mt-0.5 block text-[11px] text-muted-foreground/70">
                      {group.items.length} updates
                      {unreadInGroup > 0 && (
                        <span className="ml-1.5 rounded-full bg-red-100 px-1.5 text-[10px] font-semibold text-red-700">
                          {unreadInGroup} new
                        </span>
                      )}{" "}
                      · {relativeTime(latest.created_at)}
                    </span>
                  </div>
                  {isExpanded ? (
                    <ChevronUp className="size-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                  )}
                </div>
                {isExpanded && (
                  <div className="border-t divide-y bg-muted/20">
                    {group.items.map((n) => {
                      const row = renderItem(n, true);
                      return n.link ? (
                        <a
                          key={n.id}
                          href={n.link}
                          onClick={() => {
                            if (!n.read_at) markOneRead(n.id);
                          }}
                          className="block hover:bg-muted/50 transition-colors"
                        >
                          {row}
                        </a>
                      ) : (
                        <div
                          key={n.id}
                          className="hover:bg-muted/50 transition-colors"
                        >
                          {row}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          Page {page} of {pages} · {total} total
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
            disabled={offset === 0}
            className="inline-flex items-center gap-1 rounded-md border border-input bg-background px-2.5 py-1 hover:bg-muted disabled:opacity-40 transition-colors"
          >
            <ChevronLeft className="size-4" /> Prev
          </button>
          <button
            onClick={() => setOffset((o) => o + PAGE_SIZE)}
            disabled={offset + PAGE_SIZE >= total}
            className="inline-flex items-center gap-1 rounded-md border border-input bg-background px-2.5 py-1 hover:bg-muted disabled:opacity-40 transition-colors"
          >
            Next <ChevronRight className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
