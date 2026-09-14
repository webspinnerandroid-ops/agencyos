import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { getCurrentWorkspaceId } from "@/lib/workspace";

/**
 * POST /api/scheduled/resolve — resolve a persistent publish failure from
 * the Scheduled panel.
 *
 *   { postId, action: "retry" }             → re-queue a publish attempt now
 *   { postId, action: "dismiss", reason }   → human says "won't fix"
 *
 * "Retry" re-enters the post in the retry sweeper as a FRESH attempt: it
 * clears publish_retry_count, publish_dismissed_at, publish_dismiss_reason
 * and stamps publish_retry_at = now. A fresh attempt means a success right
 * after an escalation reads as a recovery in the health email and the panel
 * row disappears the moment the retry publishes.
 *
 * "Dismiss" never touches status — the failure stays in the post's history
 * (status remains `failed`); the columns just mark it as human-resolved so
 * it leaves the panel and never escalates again. The reason is required and
 * shown on the panel row so the next person sees the decision.
 */
export async function POST(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    const workspaceId = await getCurrentWorkspaceId();
    const supabase = await createServiceClient();

    const body = await request.json().catch(() => null);
    const postId = body?.postId as string | undefined;
    const action = body?.action as "retry" | "dismiss" | undefined;
    const reason = typeof body?.reason === "string" ? body.reason.trim() : "";

    if (!postId || !action) {
      return NextResponse.json(
        { error: "postId and action (retry | dismiss) are required" },
        { status: 400 }
      );
    }
    if (action === "dismiss" && !reason) {
      return NextResponse.json(
        { error: "A reason is required to dismiss a failure." },
        { status: 400 }
      );
    }

    // Tenant + workspace scoping: the row must belong to this tenant AND the
    // caller's current workspace, exactly like the panel that linked here.
    let query = supabase
      .from("posts")
      .select("id, status, publish_retry_count")
      .eq("id", postId)
      .eq("tenant_id", tenantId);
    query =
      workspaceId
        ? query.eq("workspace_id", workspaceId)
        : query.is("workspace_id", null);

    const { data: post, error: fetchErr } = await query.maybeSingle();
    if (fetchErr || !post) {
      return NextResponse.json(
        { error: "Post not found in this workspace" },
        { status: 404 }
      );
    }

    if (action === "dismiss") {
      const { error } = await supabase
        .from("posts")
        .update({
          publish_dismissed_at: new Date().toISOString(),
          publish_dismiss_reason: reason.slice(0, 500),
          // Close any pending retry so the sweeper can't resurrect a
          // dismissed failure.
          publish_retry_at: null,
        })
        .eq("id", postId)
        .eq("tenant_id", tenantId)
        .eq("status", "failed");
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      return NextResponse.json({ ok: true, action: "dismissed" });
    }

    // action === "retry" — re-queue a fresh attempt through the sweeper.
    const { error } = await supabase
      .from("posts")
      .update({
        publish_retry_count: null,
        publish_retry_at: new Date().toISOString(),
        publish_failed_at: null,
        publish_dismissed_at: null,
        publish_dismiss_reason: null,
      })
      .eq("id", postId)
      .eq("tenant_id", tenantId)
      .eq("status", "failed");
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, action: "retry_queued" });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
