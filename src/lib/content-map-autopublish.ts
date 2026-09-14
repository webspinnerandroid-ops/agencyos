/**
 * Auto-publish for content-map rows — hold → schedule, with an undo window.
 *
 * A map row with `auto_publish = "wordpress"` (or a social row with a
 * publish date) doesn't stop at a draft — but it doesn't publish the moment
 * generation finishes either. Instead the draft is HELD for
 * AUTO_PUBLISH_HOLD_MINUTES (15): status stays `draft` and
 * `auto_publish_at` is set to now + the hold. A human can cancel any time
 * in that window (cancel = auto_publish_at → NULL; the draft is kept).
 *
 * When the hold expires, `processDueHolds()` finishes the job:
 *   - blog + target wordpress → approve (`scheduled`) and hand to
 *     publishToWordPress, which posts to every connected WP site with WP
 *     status "future" for the row's planned publish date.
 *   - social (any target) → approve (`scheduled`) so the scheduled-posts
 *     cron publishes to the connected social accounts at the planned time.
 *
 * Blogs below the gate are never held — generation refuses to save
 * sub-gate drafts, same as before.
 *
 * Durability: `startHoldProcessor()` runs an in-process interval (this
 * deployment is a long-lived Node server). `processDueHolds()` is exported
 * so an Inngest cron can drive the identical seam in a serverless deploy.
 */

import { createClient } from "@supabase/supabase-js";

export const AUTO_PUBLISH_TARGETS = ["wordpress"] as const;
export type AutoPublishTarget = (typeof AUTO_PUBLISH_TARGETS)[number];

export const AUTO_PUBLISH_HOLD_MINUTES = 15;

function serviceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

/** ISO instant when a hold armed NOW would expire. */
export function holdExpiresAt(from: Date = new Date()): string {
  return new Date(
    from.getTime() + AUTO_PUBLISH_HOLD_MINUTES * 60 * 1000
  ).toISOString();
}

/**
 * Arm the 15-minute hold on a freshly generated draft. The post stays
 * `draft` — nothing publishes until the hold expires and nobody cancels.
 */
export async function armAutoPublishHold(
  tenantId: string,
  postId: string,
  scheduledAt: string
): Promise<void> {
  const { error } = await serviceSupabase()
    .from("posts")
    .update({ auto_publish_at: holdExpiresAt() })
    .eq("id", postId)
    .eq("tenant_id", tenantId);
  if (error) {
    console.error("[auto-publish] Failed to arm hold:", error.message);
  }
}

/**
 * Cancel a hold. The draft is kept exactly as-is (status stays draft,
 * suggested schedule untouched) — only the automation is removed. Safe to
 * call repeatedly; returns false when there was nothing to cancel.
 */
export async function cancelAutoPublish(
  tenantId: string,
  postId: string
): Promise<boolean> {
  const supabase = serviceSupabase();
  const { data } = await supabase
    .from("posts")
    .select("id")
    .eq("id", postId)
    .eq("tenant_id", tenantId)
    .not("auto_publish_at", "is", null)
    .maybeSingle();
  if (!data) return false;
  const { error } = await supabase
    .from("posts")
    .update({ auto_publish_at: null })
    .eq("id", postId)
    .eq("tenant_id", tenantId);
  return !error;
}

/** Outcome of one hold being processed. */
export interface HoldResult {
  postId: string;
  kind: "wordpress" | "social";
  ok: boolean;
  message: string;
}

/**
 * Per-post alert for a FAILED hold resolution — failures stay individual so
 * each error is visible on its own row (successes are the ones that group).
 * Never throws: a notification hiccup must not fail the hold pass.
 */
async function notifyHoldFailed(
  tenantId: string,
  postId: string,
  kind: HoldResult["kind"],
  message: string
): Promise<void> {
  try {
    const { createNotification } = await import("@/lib/in-app-notifications");
    await createNotification({
      tenantId,
      kind: "alert",
      title: kind === "wordpress" ? "WordPress auto-publish failed" : "Social auto-queue failed",
      body: message,
      link: `/dashboard/posts?post=${postId}`,
      groupKey: `post:${postId}`,
    });
  } catch (err) {
    console.warn("[auto-publish] hold notification failed:", err);
  }
}

/**
 * Bell notifications for processed holds — GROUPED per client (one row per
 * client per pass, not one per post; see publishing/grouped-notifications.ts).
 * Success = info, failure = alert. A single-post pass keeps the exact
 * single-post shape that existed before grouping.
 */
async function holdGroupers() {
  const { PublishNotificationGrouper } = await import(
    "@/lib/publishing/grouped-notifications"
  );
  const line = (p: { title: string; detail: string }) =>
    `• ${p.title}${p.detail && p.detail !== p.title ? ` — ${p.detail}` : ""}`;
  const base = {
    lineFor: line,
    linkFor: (id: string) => `/dashboard/posts?post=${id}`,
    groupKeyFor: (id: string) => `post:${id}`,
  };
  return {
    wordpress: new PublishNotificationGrouper({
      topic: "wp_hold",
      titleOne: "Auto-published to WordPress",
      titleMany: "Auto-published to WordPress — {client}",
      ...base,
    }),
    social: new PublishNotificationGrouper({
      topic: "social_hold",
      titleOne: "Queued for social publishing",
      titleMany: "Queued for social publishing — {client}",
      ...base,
    }),
  };
}

/**
 * Process every expired hold. Called by the in-process timer (dev / this
 * deployment) and safe to call from an Inngest cron (production) — idempotent
 * per post because each hold is claimed by clearing `auto_publish_at` FIRST,
 * so concurrent passes can't double-publish.
 */
export async function processDueHolds(): Promise<HoldResult[]> {
  const supabase = serviceSupabase();
  const now = new Date().toISOString();

  const { data: due, error } = await supabase
    .from("posts")
    .select("id, tenant_id, client_id, workspace_id, status, scheduled_at, content")
    .eq("status", "draft")
    .lt("auto_publish_at", now)
    .order("auto_publish_at", { ascending: true })
    .limit(50);
  if (error) {
    console.error("[auto-publish] Hold scan failed:", error.message);
    return [];
  }
  if (!due || due.length === 0) return [];

  const results: HoldResult[] = [];
  const groupers = await holdGroupers();
  for (const post of due) {
    // Claim: clear the hold BEFORE acting — a crash mid-process leaves a
    // published post, never a double-publish. The predicate makes this a
    // compare-and-swap (NULL < now is false, so an already-claimed hold
    // can't be re-claimed), and .select() verifies THIS pass won the claim:
    // with the Inngest cron and the in-process timer racing the same due
    // post, the loser must skip, or both would publish.
    const { data: claimed, error: claimErr } = await supabase
      .from("posts")
      .update({ auto_publish_at: null })
      .eq("id", post.id)
      .eq("status", "draft")
      .lt("auto_publish_at", now)
      .select("id");
    if (claimErr || !claimed || claimed.length === 0) continue;

    const parsed =
      typeof post.content === "string"
        ? (() => {
            try {
              return JSON.parse(post.content) as Record<string, unknown>;
            } catch {
              return null;
            }
          })()
        : (post.content as Record<string, unknown> | null);
    const kind: HoldResult["kind"] = parsed?.type === "social" ? "social" : "wordpress";

    // The planned publish time: prefer the post's own scheduled_at (the CSV
    // date that rode through generation); fall back to the hold expiry.
    const plannedAt =
      (typeof post.scheduled_at === "string" && post.scheduled_at) ||
      new Date().toISOString();

    if (kind === "wordpress") {
      const ok = await scheduleBlogToWordPress(
        post.tenant_id as string,
        post.id as string,
        plannedAt
      );
      const message = ok
        ? `Scheduled to WordPress for ${plannedAt.slice(0, 10)}.`
        : "WordPress scheduling failed — the draft stays scheduled in the app; publish manually or fix the site connection.";
      results.push({ postId: post.id, kind, ok, message });
      if (ok) {
        // Successes are grouped per client (one bell row per pass).
        groupers.wordpress.add(post.tenant_id as string, (post.client_id as string | null) ?? null, {
          postId: post.id as string,
          title:
            typeof parsed?.title === "string" && parsed.title
              ? parsed.title
              : "Scheduled post",
          detail: `Scheduled for ${plannedAt.slice(0, 10)}`,
          kind: "info",
        });
      } else {
        // Failures stay per-post alerts — each needs its own error visible.
        void notifyHoldFailed(post.tenant_id as string, post.id as string, kind, message);
      }
    } else {
      // Social: hand to the scheduled-posts cron. status 'scheduled' +
      // scheduled_at is exactly the state the cron publishes from.
      const { error: socErr } = await supabase
        .from("posts")
        .update({ status: "scheduled", scheduled_at: plannedAt })
        .eq("id", post.id)
        .eq("tenant_id", post.tenant_id as string);
      const message = socErr
        ? socErr.message
        : `Queued for the publish cron at ${plannedAt}.`;
      results.push({ postId: post.id, kind, ok: !socErr, message });
      if (!socErr) {
        groupers.social.add(post.tenant_id as string, (post.client_id as string | null) ?? null, {
          postId: post.id as string,
          title:
            typeof parsed?.title === "string" && parsed.title
              ? parsed.title
              : "Scheduled post",
          detail: `Queued for ${plannedAt.slice(0, 10)}`,
          kind: "info",
        });
      } else {
        void notifyHoldFailed(post.tenant_id as string, post.id as string, kind, message);
      }
    }
  }
  // One grouped notification per (tenant, client, channel) for this pass.
  try {
    await groupers.wordpress.flush();
    await groupers.social.flush();
  } catch (err) {
    console.warn("[auto-publish] grouped notifications failed:", err);
  }
  return results;
}

/** Approve + schedule a held blog to all connected WordPress sites. */
async function scheduleBlogToWordPress(
  tenantId: string,
  postId: string,
  scheduledAt: string
): Promise<boolean> {
  const supabase = serviceSupabase();
  const { error: statusErr } = await supabase
    .from("posts")
    .update({ status: "scheduled", scheduled_at: scheduledAt })
    .eq("id", postId)
    .eq("tenant_id", tenantId);
  if (statusErr) {
    console.error("[auto-publish] Approve failed:", statusErr.message);
    return false;
  }
  const { publishToWordPress } = await import("@/lib/publishing/wordpressPublisher");
  const wp = await publishToWordPress(postId, tenantId, "schedule", scheduledAt);
  if (!wp.allSucceeded) {
    const firstError =
      wp.results.find((r) => !r.success)?.errorMessage ?? "unknown error";
    console.error(
      `[auto-publish] WordPress schedule failed for post ${postId}: ${firstError}`
    );
    return false;
  }
  return true;
}

// ----------------------------------------------------------------------------
// In-process hold processor: an interval that sweeps due holds. In-process
// durability matches the batch runner's design for this deployment (long-lived
// Node server); processDueHolds() is the seam a serverless deploy would drive
// from Inngest instead.
// ----------------------------------------------------------------------------

const HOLD_SCAN_INTERVAL_MS = 60_000;
let holdTimer: ReturnType<typeof setInterval> | null = null;

export function startHoldProcessor(): void {
  if (holdTimer) return;
  holdTimer = setInterval(() => {
    void processDueHolds().catch((err) =>
      console.error("[auto-publish] Hold pass failed:", err)
    );
  }, HOLD_SCAN_INTERVAL_MS);
  // Don't keep the process alive just for the sweeper.
  holdTimer.unref?.();
}

// Auto-start when the module is imported by server code (Next dev/prod
// server). Idempotent.
if (process.env.NEXT_RUNTIME === "nodejs") {
  startHoldProcessor();
}
