// ============================================================================
// In-app notifications — the top-nav bell.
//
// AI employees (chat replies, scheduled publish, approval flows) and the
// background cron jobs write rows into the `notifications` table so the user
// gets a red-dot bell with links back to the work.
//
// These helpers are request-scope-free on purpose: the Inngest workers call
// `createNotification` with an explicit tenantId (no cookies/headers), and the
// API route resolves the current tenant then calls the list/mark-read helpers
// with that id. One module, both execution contexts.
//
// Realtime: after an insert we broadcast on the tenant's channel
// (`notifications:<tenantId>`) so open bell dropdowns update instantly; the
// bell also polls as a fallback. Broadcast needs no table publication or RLS
// changes (RLS on this table is a deny-all — only server code reads it).
//
// (Separate from notifications.ts, which holds the outbound *email*
// notification utilities.)
// ============================================================================

import { createServiceClient } from "@/lib/supabase/server";

export type NotificationKind = "info" | "progress" | "approval" | "alert";

export interface NotificationRow {
  id: string;
  tenant_id: string;
  user_id: string | null;
  kind: NotificationKind;
  title: string;
  body: string | null;
  link: string | null;
  group_key: string | null;
  read_at: string | null;
  created_at: string;
}

export interface CreateNotificationInput {
  tenantId: string;
  /** Null = all users in the tenant. */
  userId?: string | null;
  kind?: NotificationKind;
  title: string;
  body?: string;
  link?: string;
  /**
   * Groups related notifications (e.g. `post:<id>` or `chat:<id>`) so the
   * notifications center collapses a burst of updates into one entry.
   */
  groupKey?: string;
}

export interface ListNotificationsOptions {
  limit?: number;
  offset?: number;
  kind?: NotificationKind | null;
}

/**
 * Insert a notification. Never throws — notification failures must not take
 * down the worker (or the reply) that produced the underlying work.
 */
export async function createNotification(
  input: CreateNotificationInput
): Promise<void> {
  try {
    const supabase = await createServiceClient();
    const { error } = await supabase.from("notifications").insert({
      tenant_id: input.tenantId,
      user_id: input.userId ?? null,
      kind: input.kind ?? "info",
      title: input.title,
      body: input.body ?? null,
      link: input.link ?? null,
      group_key: input.groupKey ?? null,
    });
    if (error) {
      console.warn("[in-app-notifications] insert failed:", error.message);
      return;
    }
    // Fire the realtime broadcast after a successful insert so open bell
    // dropdowns update instantly (fire-and-forget — never block the caller).
    void broadcastNotification(input.tenantId);
    // Mirror the notification to the user's bound Telegram chat(s) when a bot
    // is configured. Fire-and-forget — a Telegram hiccup must never take
    // down the worker that produced the notification.
    try {
      const { telegramNotify } = await import("@/lib/telegram");
      void telegramNotify({
        tenantId: input.tenantId,
        userId: input.userId,
        kind: input.kind ?? "info",
        title: input.title,
        body: input.body,
        link: input.link,
      });
    } catch (err) {
      console.warn("[in-app-notifications] telegram mirror failed:", err);
    }
    try {
      const { discordNotify } = await import("@/lib/discord");
      void discordNotify({
        tenantId: input.tenantId,
        kind: input.kind ?? "info",
        title: input.title,
        body: input.body,
        link: input.link,
      });
    } catch (err) {
      console.warn("[in-app-notifications] discord mirror failed:", err);
    }
    // Web push (PWA): an empty-payload push wakes the service worker, which
    // fetches the real payload from /api/push/pending. Fire-and-forget — a
    // push failure must never break the notification itself.
    try {
      const { webPushNotify } = await import("@/lib/web-push");
      void webPushNotify({
        tenantId: input.tenantId,
        userId: input.userId,
        kind: input.kind ?? "info",
        title: input.title,
        body: input.body,
        link: input.link,
      });
    } catch (err) {
      console.warn("[in-app-notifications] web push mirror failed:", err);
    }
  } catch (err) {
    console.warn("[in-app-notifications] create failed:", err);
  }
}

/**
 * Broadcast a "new notification" event on the tenant's realtime channel.
 * Best-effort: a failed broadcast (realtime down, worker without socket
 * access) must never break the notification itself — the bell's polling is
 * the fallback.
 */
export async function broadcastNotification(tenantId: string): Promise<void> {
  try {
    const supabase = await createServiceClient();
    const channel = supabase.channel(`notifications:${tenantId}`);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("subscribe timeout")), 5000);
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          clearTimeout(timer);
          resolve();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          clearTimeout(timer);
          reject(new Error(`subscribe ${status}`));
        }
      });
    });
    await channel.send({
      type: "broadcast",
      event: "new",
      payload: { at: Date.now() },
    });
    await supabase.removeChannel(channel);
  } catch (err) {
    // Ignore — polling is the fallback.
  }
}

/** Most recent notifications for a tenant, newest first. */
export async function listNotifications(
  tenantId: string,
  options: ListNotificationsOptions = {}
): Promise<NotificationRow[]> {
  try {
    const supabase = await createServiceClient();
    const limit = Math.min(Math.max(options.limit ?? 30, 1), 50);
    const offset = Math.max(options.offset ?? 0, 0);
    let query = supabase
      .from("notifications")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (options.kind) {
      query = query.eq("kind", options.kind);
    }
    const { data, error } = await query;
    if (error) {
      console.warn("[in-app-notifications] list failed:", error.message);
      return [];
    }
    return (data ?? []) as NotificationRow[];
  } catch (err) {
    console.warn("[in-app-notifications] list failed:", err);
    return [];
  }
}

/** Total notifications matching the (optional) kind filter. */
export async function countNotifications(
  tenantId: string,
  kind?: NotificationKind | null
): Promise<number> {
  try {
    const supabase = await createServiceClient();
    let query = supabase
      .from("notifications")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId);
    if (kind) {
      query = query.eq("kind", kind);
    }
    const { count, error } = await query;
    if (error) {
      console.warn("[in-app-notifications] count failed:", error.message);
      return 0;
    }
    return count ?? 0;
  } catch (err) {
    console.warn("[in-app-notifications] count failed:", err);
    return 0;
  }
}

/** Unread counts per kind (for the notifications center filter tabs). */
export async function getUnreadCountsByKind(
  tenantId: string
): Promise<Record<NotificationKind, number>> {
  const counts: Record<NotificationKind, number> = {
    info: 0,
    progress: 0,
    approval: 0,
    alert: 0,
  };
  try {
    const supabase = await createServiceClient();
    const { data, error } = await supabase
      .from("notifications")
      .select("kind")
      .eq("tenant_id", tenantId)
      .is("read_at", null);
    if (error) {
      console.warn("[in-app-notifications] unread-by-kind failed:", error.message);
      return counts;
    }
    for (const row of data ?? []) {
      const k = row.kind as NotificationKind;
      if (k in counts) counts[k] += 1;
    }
  } catch (err) {
    console.warn("[in-app-notifications] unread-by-kind failed:", err);
  }
  return counts;
}

/** Count of unread notifications for the red dot. */
export async function getUnreadNotificationCount(
  tenantId: string
): Promise<number> {
  try {
    const supabase = await createServiceClient();
    const { count, error } = await supabase
      .from("notifications")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .is("read_at", null);
    if (error) {
      console.warn("[in-app-notifications] unread count failed:", error.message);
      return 0;
    }
    return count ?? 0;
  } catch (err) {
    console.warn("[in-app-notifications] unread count failed:", err);
    return 0;
  }
}

/**
 * Mark notifications read. Pass explicit `ids` to mark a subset; pass null to
 * mark everything unread as read.
 */
export async function markNotificationsRead(
  tenantId: string,
  ids: string[] | null
): Promise<void> {
  try {
    const supabase = await createServiceClient();
    let query = supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .is("read_at", null);
    if (ids !== null) {
      // A specific (possibly empty) subset — never fall through to mark-all.
      if (ids.length === 0) return;
      query = query.in("id", ids);
    }
    const { error } = await query;
    if (error) {
      console.warn("[in-app-notifications] mark-read failed:", error.message);
    }
  } catch (err) {
    console.warn("[in-app-notifications] mark-read failed:", err);
  }
}

/**
 * Mark every notification pointing at a given in-app link as read. Used when
 * the user opens the linked page directly (not via the bell), so the dot
 * clears once they've seen the work.
 */
export async function markNotificationsReadByLink(
  tenantId: string,
  link: string
): Promise<void> {
  try {
    if (!link || !link.startsWith("/")) return;
    const supabase = await createServiceClient();
    const { error } = await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .eq("link", link)
      .is("read_at", null);
    if (error) {
      console.warn("[in-app-notifications] read-by-link failed:", error.message);
    }
  } catch (err) {
    console.warn("[in-app-notifications] read-by-link failed:", err);
  }
}

/** Delete notifications by id (empty array = no-op). */
export async function deleteNotifications(
  tenantId: string,
  ids: string[]
): Promise<void> {
  try {
    if (!ids || ids.length === 0) return;
    const supabase = await createServiceClient();
    const { error } = await supabase
      .from("notifications")
      .delete()
      .eq("tenant_id", tenantId)
      .in("id", ids);
    if (error) {
      console.warn("[in-app-notifications] delete failed:", error.message);
    }
  } catch (err) {
    console.warn("[in-app-notifications] delete failed:", err);
  }
}
