import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { getCurrentWorkspaceId } from "@/lib/workspace";

/**
 * GET /api/scheduled — everything currently queued for the publish cron,
 * workspace-scoped.
 *
 * A post is "queued for the publish cron" exactly when its status is
 * `scheduled` and its `scheduled_at` is set — the two fields
 * publishScheduledPosts polls on (status = 'scheduled', scheduled_at <= now).
 *
 * Rows split into:
 *   - upcoming: scheduled_at in the future (waiting for their slot)
 *   - due:      scheduled_at <= now (the next cron pass will publish them;
 *               nothing is stuck until it is also >1h past due)
 *   - overdue:  scheduled_at more than 1h in the past (the cron passed them
 *               repeatedly and did not publish — investigate)
 *
 * Failed posts are surfaced separately as `persistentFailures`: status
 * `failed` with an exhausted retry ladder (publish_retry_count >= MAX,
 * retry marker cleared — the self-heal sweeper gave up on them and a human
 * needs to look). Failures still inside the retry ladder are NOT surfaced —
 * they are expected to recover on their own.
 */
export async function GET(_request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    const workspaceId = await getCurrentWorkspaceId();
    const supabase = await createServiceClient();

    let query = supabase
      .from("posts")
      .select(
        "id, status, scheduled_at, auto_publish_at, created_at, client_id, seo_score, aeo_geo_score, content"
      )
      .eq("tenant_id", tenantId)
      .eq("status", "scheduled")
      .not("scheduled_at", "is", null)
      .order("scheduled_at", { ascending: true })
      .limit(500);

    if (workspaceId) {
      query = query.eq("workspace_id", workspaceId);
    } else {
      // No resolvable workspace — show nothing rather than every
      // workspace's queue (same convention as the posts page).
      query = query.is("workspace_id", null);
    }

    const { data: rows, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const now = Date.now();
    const items = (rows ?? []).map((r) => {
      // Titles live inside the JSONB content blob; project just the title to
      // keep the payload small (content can carry megabytes of images).
      let title = "Scheduled post";
      let type = "blog";
      let platform = "";
      const c = r.content as Record<string, unknown> | null;
      if (c && typeof c === "object") {
        if (typeof c.title === "string" && c.title) title = c.title;
        else if (typeof c.caption === "string" && c.caption)
          title = c.caption.slice(0, 80);
        if (c.type === "social") type = "social";
        if (typeof c.platform === "string") platform = c.platform;
      }
      const schedMs = new Date(r.scheduled_at as string).getTime();
      return {
        id: r.id,
        title,
        type,
        platform,
        client_id: r.client_id,
        scheduled_at: r.scheduled_at,
        state:
          schedMs > now ? ("upcoming" as const)
          : now - schedMs > 60 * 60 * 1000 ? ("overdue" as const)
          : ("due" as const),
      };
    });

    return NextResponse.json({
      items,
      upcoming: items.filter((i) => i.state === "upcoming").length,
      due: items.filter((i) => i.state === "due").length,
      overdue: items.filter((i) => i.state === "overdue").length,
      persistentFailures: await persistentFailures(supabase, tenantId, workspaceId),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Failed posts whose retry ladder is exhausted (publish_retry_count at the
 * max, no retry pending) — the self-heal sweeper gave up, a human should
 * look. Same workspace scoping as the main queue.
 */
async function persistentFailures(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  tenantId: string,
  workspaceId: string | null
) {
  // posts has no updated_at column — "most recent first" is derived from
  // each post's latest publishing_logs.attempt_at in the mapping below.
  // Dismissed failures are INCLUDED (marked, with the human's reason) so the
  // decision stays visible and reversible via "Retry now".
  let query = supabase
    .from("posts")
    .select(
      "id, title, publish_retry_count, publish_failed_at, publish_dismissed_at, publish_dismiss_reason, publishing_logs(error_message, attempt_at)"
    )
    .eq("tenant_id", tenantId)
    .eq("status", "failed")
    .is("publish_retry_at", null)
    .gte("publish_retry_count", MAX_PUBLISH_RETRIES)
    .limit(50);
  if (workspaceId) {
    query = query.eq("workspace_id", workspaceId);
  } else {
    query = query.is("workspace_id", null);
  }
  const { data, error } = await query;
  if (error) {
    console.error("[scheduled] persistent failures query:", error.message);
    return [];
  }
  return (data ?? []).map((r) => {
    const logs = (r.publishing_logs ?? []) as {
      error_message: string | null;
      attempt_at: string;
    }[];
    const lastError =
      logs.slice().sort((a, b) => b.attempt_at.localeCompare(a.attempt_at))[0]
        ?.error_message ?? "no error recorded on the last attempt";
    return {
      id: r.id as string,
      title: r.title ?? "Scheduled post",
      retryCount: r.publish_retry_count ?? 0,
      lastError,
      dismissed: !!(r as Record<string, unknown>).publish_dismissed_at,
      dismissedReason:
        ((r as Record<string, unknown>).publish_dismiss_reason as string | null) ?? null,
      failedSince:
        ((r as Record<string, unknown>).publish_failed_at as string | null) ?? null,
      lastAttemptAt:
        logs.slice().sort((a, b) => b.attempt_at.localeCompare(a.attempt_at))[0]
          ?.attempt_at ?? "",
    };
  }).sort((a, b) => Number(a.dismissed) - Number(b.dismissed) || b.lastAttemptAt.localeCompare(a.lastAttemptAt));
}

/** Retry-ladder length (kept in sync with retryFailedPublishes.ts). */
const MAX_PUBLISH_RETRIES = 3;
