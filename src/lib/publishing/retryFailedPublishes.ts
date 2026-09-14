/**
 * Self-healing for failed publishes — bounded retry with backoff.
 *
 * The publish cron (publishScheduledPosts) flips a post to `failed` when its
 * platform delivery throws. Until now it stayed failed forever and only a
 * human could retry. This module sweeps failed posts on a schedule and
 * retries them with growing spacing:
 *
 *   failure → retry after 5 min → retry after 30 min → retry after 2 h
 *   → escalate (marker cleared, alert notification, surfaced in the
 *     Scheduled panel as a persistent failure)
 *
 * The backoff ladder lives entirely in `posts.publish_retry_count` +
 * `posts.publish_retry_at` (migration 106). A sweep retries every failed
 * post whose `publish_retry_at` is due, increments the count, and sets the
 * next due instant. Retries reuse the normal publishPost() path — same
 * logs, same notifications, same status transitions — so a healed post is
 * indistinguishable from a cron-published one.
 *
 * Like the hold processor, this is invoked from BOTH execution contexts:
 * an in-process interval here (long-lived Node server) and the
 * `process-publish-retries` Inngest cron (serverless). Idempotent: each
 * due post is claimed by bumping `publish_retry_at` forward BEFORE the
 * retry runs, so a crash mid-retry costs one skipped attempt, never a
 * double-publish storm.
 */

import { createClient } from "@supabase/supabase-js";
import { createNotification } from "@/lib/in-app-notifications";

/** Backoff ladder in minutes — attempt N failed → next retry after this. */
export const RETRY_BACKOFF_MINUTES = [5, 30, 120];
export const MAX_RETRIES = RETRY_BACKOFF_MINUTES.length;

function serviceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

/**
 * ISO instant the next retry is due for a post that has already completed
 * `failedCount` retries: 0 → +5 min, 1 → +30 min, 2 → +2 h. Counts at or
 * beyond the ladder clamp to the last step (escalation is decided by the
 * caller before this is ever used).
 */
export function nextRetryAt(failedCount: number, from: Date = new Date()): string {
  const idx = Math.min(Math.max(failedCount, 0), RETRY_BACKOFF_MINUTES.length - 1);
  return new Date(
    from.getTime() + RETRY_BACKOFF_MINUTES[idx] * 60 * 1000
  ).toISOString();
}

/** Best-effort title for notifications/panels. */
function titleOf(content: unknown): string {
  if (content && typeof content === "object") {
    const t = (content as Record<string, unknown>).title;
    if (typeof t === "string" && t) return t;
  }
  return "Scheduled post";
}

export interface RetryResult {
  postId: string;
  action: "retried_ok" | "retried_failed" | "escalated";
  error?: string;
}

/**
 * Sweep due retries. Safe to call from a cron and the in-process timer at
 * the same time — each due post is claimed (retry instant bumped forward)
 * before any work happens.
 */
export async function processDueRetries(): Promise<RetryResult[]> {
  const supabase = serviceSupabase();
  const now = new Date().toISOString();
  const { PublishNotificationGrouper } = await import(
    "@/lib/publishing/grouped-notifications"
  );
  const recoveryGrouper = new PublishNotificationGrouper({
    topic: "publish_retry",
    titleOne: "Failed publish recovered",
    titleMany: "Failed publish recovered — {client}",
    lineFor: (p) => `• ${p.title}${p.detail ? ` (${p.detail})` : ""}`,
    linkFor: (id) => `/dashboard/posts?post=${id}`,
    groupKeyFor: (id) => `post:${id}`,
  });

  // Two sources of due posts:
  //   A. Ladder active — failed posts whose next retry instant has passed.
  //   B. Adoption — failed posts with NO ladder state yet whose most recent
  //      publish attempt happened in the last 7 days. This catches failures
  //      from right after deploy without resurrecting ancient (pre-feature)
  //      failures, which would spam users with retries of long-dead posts.
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const [ladder, adoptable] = await Promise.all([
    supabase
      .from("posts")
      .select(
        "id, tenant_id, client_id, content, publish_retry_count, publish_retry_at, publish_failed_at"
      )
      .eq("status", "failed")
      .not("publish_retry_at", "is", null)
      .lte("publish_retry_at", now)
      .order("publish_retry_at", { ascending: true })
      .limit(50),
    supabase
      .from("posts")
      .select(
        "id, tenant_id, client_id, content, publish_retry_count, publish_retry_at, publish_failed_at, publishing_logs(attempt_at)"
      )
      .eq("status", "failed")
      .is("publish_retry_at", null)
      .is("publish_retry_count", null)
      .gte("publishing_logs.attempt_at", weekAgo)
      .limit(50),
  ]);
  if (ladder.error) {
    console.error("[publish-retries] ladder sweep failed:", ladder.error.message);
  }
  if (adoptable.error) {
    console.error("[publish-retries] adoption sweep failed:", adoptable.error.message);
  }

  const due = [
    ...(ladder.data ?? []),
    // Adopted rows carry the same shape plus the logs embed used only for
    // the filter — strip it so the loop sees one shape.
    ...(adoptable.data ?? []).map(({ publishing_logs: _logs, ...rest }) => rest),
  ];
  if (due.length === 0) return [];

  const results: RetryResult[] = [];
  const seen = new Set<string>();
  for (const post of due) {
    if (seen.has(post.id)) continue;
    seen.add(post.id);
    const count = Number(post.publish_retry_count ?? 0);

    // Ladder exhausted → escalate once (clear the marker so this fires
    // exactly once per post), alert the tenant, and leave it failed.
    if (count >= MAX_RETRIES) {
      if (post.publish_retry_at != null) {
        await supabase
          .from("posts")
          .update({ publish_retry_at: null })
          .eq("id", post.id)
          .eq("status", "failed");
        void createNotification({
          tenantId: post.tenant_id as string,
          kind: "alert",
          title: "Publishing keeps failing",
          body: `"${titleOf(post.content)}" failed ${count} automatic retries. It needs a manual look — check the post's publishing history.`,
          link: `/dashboard/posts?post=${post.id}`,
          groupKey: `post:${post.id}`,
        });
        results.push({ postId: post.id, action: "escalated" });
      }
      continue;
    }

    // Claim: bump the retry marker forward BEFORE publishing, so a second
    // sweeper (cron + timer racing) sees it as not-due. The marker must
    // still be DUE at claim time (NULL = never retried, or <= now) — that
    // makes the claim a compare-and-swap: once won, the marker is in the
    // future, so the race loser's identical update matches no rows, and the
    // .select() verification below makes it skip instead of double-publish.
    // Stamps publish_failed_at on first observation so the Scheduled panel
    // and the weekly health email can show/attribute the failure spell.
    const claimAt = nextRetryAt(count);
    const failedAt = post.publish_failed_at ?? now;
    const { data: claimedRows, error: claimErr } = await supabase
      .from("posts")
      .update({ publish_retry_at: claimAt, publish_failed_at: failedAt })
      .eq("id", post.id)
      .eq("status", "failed")
      .or(`publish_retry_at.is.null,publish_retry_at.lt.${now}`)
      .select("id");
    if (claimErr || !claimedRows || claimedRows.length === 0) continue;

    // Retry through the SAME channel the post failed on — the manual
    // publish route branches the same way: blogs go to every connected
    // WordPress site (publishToWordPress resolves blog_platforms itself and
    // writes publishing_logs + status transitions), socials go to their
    // assigned accounts via publishPost. Retrying a blog through publishPost
    // would always fail (blogs have no post_platforms rows).
    const isBlog =
      !post.content ||
      (post.content as Record<string, unknown> | null)?.type !== "social";
    try {
      let allSucceeded: boolean;
      if (isBlog) {
        const { publishToWordPress } = await import(
          "@/lib/publishing/wordpressPublisher"
        );
        const wp = await publishToWordPress(
          post.id,
          post.tenant_id as string,
          "publish"
        );
        allSucceeded = wp.allSucceeded;
        if (allSucceeded) {
          await supabase
            .from("posts")
            .update({ status: "published" })
            .eq("id", post.id)
            .eq("tenant_id", post.tenant_id as string);
        }
      } else {
        const { publishPost } = await import("@/lib/publishing/socialPublisher");
        allSucceeded = (
          await publishPost(post.id, post.tenant_id as string)
        ).allSucceeded;
      }
      if (allSucceeded) {
        // Keep the ladder metadata (attempt count feeds the health email's
        // recovered count), stop future retries, close the failure spell.
        await supabase
          .from("posts")
          .update({ publish_retry_at: null, publish_failed_at: null })
          .eq("id", post.id);
        // Recoveries are grouped per client (one bell row per pass).
        recoveryGrouper.add(
          post.tenant_id as string,
          (post.client_id as string | null) ?? null,
          {
            postId: post.id as string,
            title: titleOf(post.content),
            detail: `published on retry ${count + 1}`,
            kind: "info",
          }
        );
        results.push({ postId: post.id, action: "retried_ok" });
      } else {
        // publishPost set status='failed' again. Advance the ladder AND
        // reschedule the marker to the next step's delay (the claim only
        // moved it by the previous step's amount).
        await supabase
          .from("posts")
          .update({
            publish_retry_count: count + 1,
            publish_retry_at: nextRetryAt(count + 1),
          })
          .eq("id", post.id)
          .eq("status", "failed");
        results.push({
          postId: post.id,
          action: "retried_failed",
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown error";
      await supabase
        .from("posts")
        .update({
          publish_retry_count: count + 1,
          publish_retry_at: nextRetryAt(count + 1),
        })
        .eq("id", post.id)
        .eq("status", "failed");
      results.push({ postId: post.id, action: "retried_failed", error: msg });
    }
  }
  // One grouped recovery notification per (tenant, client) for this pass.
  try {
    await recoveryGrouper.flush();
  } catch (err) {
    console.warn("[publish-retries] grouped notifications failed:", err);
  }
  return results;
}

// ---------------------------------------------------------------------------
// In-process sweeper (dev / long-lived deployment). The Inngest cron
// `process-publish-retries` drives the same seam on serverless.
// ---------------------------------------------------------------------------

const RETRY_SCAN_INTERVAL_MS = 60_000;
let retryTimer: ReturnType<typeof setInterval> | null = null;

export function startRetryProcessor(): void {
  if (retryTimer) return;
  retryTimer = setInterval(() => {
    void processDueRetries().catch((err) =>
      console.error("[publish-retries] pass failed:", err)
    );
  }, RETRY_SCAN_INTERVAL_MS);
  retryTimer.unref?.();
}

if (process.env.NEXT_RUNTIME === "nodejs") {
  startRetryProcessor();
}
