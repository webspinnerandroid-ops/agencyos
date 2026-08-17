import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { submitPostToIndexNow } from "@/lib/seo/indexnow";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const tenantId = await getTenantId();
    const supabase = await createServiceClient();
    const { id } = await params;

    const { data: post, error } = await supabase
      .from("posts")
      .select("id, content, status, ai_generated, scheduled_at, tier_level, client_id")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .single();

    if (error || !post) {
      return NextResponse.json(
        { error: "Post not found or access denied" },
        { status: 404 }
      );
    }

    return NextResponse.json({ post });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const tenantId = await getTenantId();
    const supabase = await createServiceClient();
    const { id } = await params;

    // Verify the post belongs to this tenant before touching anything.
    const { data: existing } = await supabase
      .from("posts")
      .select("id, tenant_id, status")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!existing) {
      return NextResponse.json({ error: "Post not found or access denied" }, { status: 404 });
    }

    // Explicitly clear dependents so a live-schema FK that isn't ON DELETE
    // CASCADE can never block the delete (and each step is isolated: one
    // failing child must not abort the rest).
    const children: [string, string][] = [
      ["post_platforms", "post_id"],
      ["comments", "post_id"],
      ["analytics_snapshots", "post_id"],
      ["publishing_logs", "post_id"],
    ];
    for (const [table, col] of children) {
      try {
        const { error } = await supabase.from(table).delete().eq(col, id);
        if (error) {
          console.warn(`[posts/delete] cleanup ${table} failed (continuing):`, error.message);
        }
      } catch (err) {
        console.warn(`[posts/delete] cleanup ${table} threw (continuing):`, err);
      }
    }
    // Campaign items may point at this post — null the link so the plan row
    // survives and loses its content reference.
    try {
      const { error: linkErr } = await supabase
        .from("campaign_plan_items")
        .update({ linked_post_id: null })
        .eq("linked_post_id", id)
        .eq("tenant_id", tenantId);
      if (linkErr) {
        console.warn("[posts/delete] detach campaign link failed (warn):", linkErr.message);
      }
    } catch (err) {
      console.warn("[posts/delete] detach campaign link threw (warn):", err);
    }

    const { error } = await supabase
      .from("posts")
      .delete()
      .eq("id", id)
      .eq("tenant_id", tenantId);

    if (error) {
      // Surface the real DB reason so the UI can show it instead of a
      // generic "failed" — much easier to diagnose from the user's side.
      const details =
        (error as { message?: string }).message ?? JSON.stringify(error);
      console.error(`[posts/delete] Failed deleting post ${id}:`, details);
      return NextResponse.json(
        { error: "Failed to delete post", details },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const tenantId = await getTenantId();
    const supabase = await createServiceClient();
    const { id } = await params;

    const body = await request.json();
    const { scheduled_at, status, workspace_id, revision_reason } = body;

    if (scheduled_at === undefined && status === undefined && workspace_id === undefined && revision_reason === undefined) {
      return NextResponse.json(
        { error: "scheduled_at, status, workspace_id, or revision_reason is required" },
        { status: 400 }
      );
    }

    // Verify the post belongs to this tenant before updating
    const { data: existing, error: fetchError } = await supabase
      .from("posts")
      .select("id, tenant_id, status")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .single();

    if (fetchError || !existing) {
      return NextResponse.json(
        { error: "Post not found or access denied" },
        { status: 404 }
      );
    }

    // Content-approval gate: nothing gets scheduled or published unless a
    // human has approved the generated content first (approved → scheduled →
    // published). Rescheduling/publishing already-approved work is fine.
    const currentStatus = existing.status;
    const nextStatus = status ?? currentStatus;
    if (
      (nextStatus === "scheduled" || nextStatus === "published") &&
      currentStatus !== "approved" &&
      currentStatus !== "scheduled" &&
      currentStatus !== "published"
    ) {
      return NextResponse.json(
        {
          error:
            "Content must be approved before it can be scheduled or published. Approve the post first.",
        },
        { status: 403 }
      );
    }

    if (workspace_id !== undefined) {
      // Verify the target workspace belongs to this tenant
      const { data: ws, error: wsError } = await supabase
        .from("workspaces")
        .select("id")
        .eq("id", workspace_id)
        .eq("tenant_id", tenantId)
        .maybeSingle();

      if (wsError || !ws) {
        return NextResponse.json(
          { error: "Target workspace not found or access denied" },
          { status: 404 }
        );
      }
    }

    const updates: Record<string, unknown> = {};
    if (scheduled_at !== undefined) updates.scheduled_at = scheduled_at;
    if (status !== undefined) updates.status = status;
    if (workspace_id !== undefined) updates.workspace_id = workspace_id;
    // Revision reason: required when sending content back for revision, so
    // the team actually knows what to change. Cleared on a fresh status.
    if (revision_reason !== undefined) updates.revision_reason = revision_reason;
    if (nextStatus !== "revision_requested") updates.revision_reason = null;

    const { data: updated, error: updateError } = await supabase
      .from("posts")
      .update(updates)
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .select(
        `
        id,
        content,
        media_urls,
        scheduled_at,
        status,
        created_by,
        approved_by,
        ai_generated,
        tier_level,
        client_id,
        revision_reason,
        post_platforms (
          id,
          social_account_id,
          social_accounts (
            id,
            platform
          )
        )
      `
      )
      .single();

    if (updateError) {
      return NextResponse.json(
        { error: "Failed to update post", details: updateError },
        { status: 500 }
      );
    }

    // Auto-indexer: newly published (or edited-while-published) posts get
    // submitted to IndexNow + a Google sitemap ping. Fire-and-forget — never
    // blocks the publish/update response, never throws.
    if (
      updated?.status === "published" ||
      (currentStatus === "published" && Object.keys(updates).length > 0)
    ) {
      // Resolve the tenant's site URL (blog_platforms site_url, else the
      // post's client website) so the canonical URL is correct per tenant.
      const { data: blogPlatform } = await supabase
        .from("blog_platforms")
        .select("site_url")
        .eq("tenant_id", tenantId)
        .limit(1)
        .maybeSingle();
      let siteUrl = blogPlatform?.site_url ?? null;
      if (!siteUrl && updated?.client_id) {
        const { data: client } = await supabase
          .from("clients")
          .select("website")
          .eq("id", updated.client_id)
          .eq("tenant_id", tenantId)
          .maybeSingle();
        siteUrl = client?.website ?? null;
      }
      void submitPostToIndexNow({
        tenantId,
        siteUrl,
        content: updated.content,
      }).then((r) => {
        if (r.ok) {
          console.log(`[indexnow] Submitted ${r.urls.join(", ")}`);
        } else if (r.error) {
          console.warn(`[indexnow] Skipped: ${r.error}`);
        }
      });
    }

    return NextResponse.json({ post: updated });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}