import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const tenantId = await getTenantId();
    const supabase = await createServiceClient();
    const { id } = await params;

    const { error } = await supabase
      .from("posts")
      .delete()
      .eq("id", id)
      .eq("tenant_id", tenantId);

    if (error) {
      return NextResponse.json(
        { error: "Failed to delete post", details: error },
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
    const { scheduled_at, status, workspace_id } = body;

    if (scheduled_at === undefined && status === undefined && workspace_id === undefined) {
      return NextResponse.json(
        { error: "scheduled_at, status, or workspace_id is required" },
        { status: 400 }
      );
    }

    // Verify the post belongs to this tenant before updating
    const { data: existing, error: fetchError } = await supabase
      .from("posts")
      .select("id, tenant_id")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .single();

    if (fetchError || !existing) {
      return NextResponse.json(
        { error: "Post not found or access denied" },
        { status: 404 }
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

    return NextResponse.json({ post: updated });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}