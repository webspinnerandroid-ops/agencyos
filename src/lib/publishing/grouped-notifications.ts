/**
 * Grouped publish notifications — one bell row per CLIENT, not per post.
 *
 * A batch generation can resolve a dozen holds within minutes; before this
 * module each one rang the bell separately and the notifications center
 * drowned in near-identical rows. This grouper folds same-topic events for
 * posts of the same client into ONE notification:
 *
 *   1 post  → the existing single-post notification (unchanged behavior)
 *   N posts → "Auto-published to WordPress — 6 posts for Decore Hotels",
 *             body lists each title, link to the Scheduled panel.
 *
 * Sessions: an event "session" is one processDueHolds()/processDueRetries()
 * pass — the natural batch boundary. A per-pass run posts at most one
 * notification per (tenant, client, topic, kind). Unread bookkeeping stays
 * per-post: every post's own groupKey still gets a marker row (same title
 * as the grouped one) so opening the post or its notification clears the
 * dot for exactly that post's contribution. Marker rows are inserted
 * DIRECTLY (not through createNotification) so they never fan out to
 * Telegram/Discord/push — the grouped row already announced the event.
 */

import { createNotification, type NotificationKind } from "@/lib/in-app-notifications";
import { createClient } from "@supabase/supabase-js";

function serviceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export interface GroupedEventSpec {
  /** Stable topic id, e.g. "wp_hold" or "publish_retry" — part of the key. */
  topic: string;
  /** Notification title for a single-post event. */
  titleOne: string;
  /** Notification title for a multi-post event; {client} is replaced. */
  titleMany: string;
  /** Per-post line inside the grouped body. */
  lineFor: (post: { title: string; detail: string }) => string;
  linkFor: (postId: string) => string;
  /** The post's own groupKey (marker rows use the same key). */
  groupKeyFor: (postId: string) => string;
}

interface PendingPost {
  postId: string;
  title: string;
  detail: string;
  kind: NotificationKind;
}

/**
 * Buffer per (tenant, client, topic, kind). Call `add()` per event, then
 * `flush()` at the end of the pass — it posts one grouped notification per
 * bucket (single-post buckets keep the plain single-post shape) and one
 * unread marker per post.
 */
export class PublishNotificationGrouper {
  private buckets = new Map<string, PendingPost[]>();

  constructor(private readonly spec: GroupedEventSpec) {}

  add(
    tenantId: string,
    clientId: string | null,
    post: PendingPost
  ): void {
    const key = `${tenantId}|${clientId ?? "none"}|${this.spec.topic}|${post.kind}`;
    const bucket = this.buckets.get(key) ?? [];
    bucket.push(post);
    this.buckets.set(key, bucket);
  }

  async flush(): Promise<void> {
    const supabase = serviceSupabase();
    for (const [key, bucket] of this.buckets) {
      if (bucket.length === 0) continue;
      const [tenantId, clientKey] = key.split("|");
      const clientId = clientKey === "none" ? null : clientKey;
      const kind = bucket[0].kind;
      const first = bucket[0];

      if (bucket.length === 1) {
        // Single post — the familiar per-post notification. It IS the
        // post's unread row (same groupKey), so no marker is needed.
        await createNotification({
          tenantId,
          kind,
          title: this.spec.titleOne,
          body: first.detail,
          link: this.spec.linkFor(first.postId),
          groupKey: this.spec.groupKeyFor(first.postId),
        });
        continue;
      } else {
        const clientName = await this.resolveClientName(supabase, clientId);
        const lines = bucket.map((p) => this.spec.lineFor(p)).join("\n");
        await createNotification({
          tenantId,
          kind,
          title: `${this.spec.titleMany.replace("{client}", clientName)} (${bucket.length})`,
          body: lines.slice(0, 1800),
          link: "/dashboard/scheduled",
          groupKey: `client:${clientId ?? "none"}`,
        });
      }

      // Per-post unread markers — direct inserts so they don't re-fan-out
      // to Telegram/Discord/push. Clearing a post's dot stays exact.
      const rows = bucket.map((p) => ({
        tenant_id: tenantId,
        user_id: null,
        kind: p.kind,
        title: this.spec.titleOne,
        body: p.detail,
        link: this.spec.linkFor(p.postId),
        group_key: this.spec.groupKeyFor(p.postId),
      }));
      if (rows.length > 0) {
        const { error } = await supabase.from("notifications").insert(rows);
        if (error) {
          console.warn(
            "[grouped-notifications] marker insert failed:",
            error.message
          );
        }
      }
    }
    this.buckets.clear();
  }

  private async resolveClientName(
    supabase: ReturnType<typeof serviceSupabase>,
    clientId: string | null
  ): Promise<string> {
    if (!clientId) return "your workspace";
    try {
      const { data } = await supabase
        .from("clients")
        .select("name")
        .eq("id", clientId)
        .maybeSingle();
      return data?.name ?? "your workspace";
    } catch {
      return "your workspace";
    }
  }
}
