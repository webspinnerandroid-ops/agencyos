import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * PATCH /api/media-assets/[id]
 * Reassigns a media asset to another workspace (move between workspaces
 * of the same tenant). Body: { workspaceId }
 *
 * DELETE /api/media-assets/[id]
 * Deletes the asset record (scoped to the tenant).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const tenantId = await getTenantId();
    const supabase = await createServiceClient();
    const { id } = await params;

    const body = await request.json();
    const { workspaceId } = body;

    if (!workspaceId || typeof workspaceId !== "string") {
      return NextResponse.json(
        { error: "workspaceId is required" },
        { status: 400 }
      );
    }

    // Verify the asset belongs to this tenant
    const { data: existing, error: fetchError } = await supabase
      .from("media_assets")
      .select("id, tenant_id, workspace_id")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .single();

    if (fetchError || !existing) {
      return NextResponse.json(
        { error: "Asset not found or access denied" },
        { status: 404 }
      );
    }

    // Verify the target workspace belongs to this tenant
    const { data: ws, error: wsError } = await supabase
      .from("workspaces")
      .select("id")
      .eq("id", workspaceId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (wsError || !ws) {
      return NextResponse.json(
        { error: "Target workspace not found or access denied" },
        { status: 404 }
      );
    }

    const { data: updated, error: updateError } = await supabase
      .from("media_assets")
      .update({ workspace_id: workspaceId })
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .select("id, url, prompt, workspace_id, created_at")
      .single();

    if (updateError) {
      return NextResponse.json(
        { error: "Failed to reassign asset", details: updateError },
        { status: 500 }
      );
    }

    return NextResponse.json({ asset: updated });
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

    const { error } = await supabase
      .from("media_assets")
      .delete()
      .eq("id", id)
      .eq("tenant_id", tenantId);

    if (error) {
      return NextResponse.json(
        { error: "Failed to delete asset", details: error },
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