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
    const { workspaceId, folderId } = body;

    if (!workspaceId && !folderId) {
      return NextResponse.json(
        { error: "Provide a workspaceId and/or folderId to update" },
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

    // Verify the target workspace belongs to this tenant (when moving).
    if (workspaceId) {
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
    }

    // Verify the target folder belongs to this tenant (when filing).
    if (folderId) {
      const { data: folder, error: folderError } = await supabase
        .from("asset_folders")
        .select("id")
        .eq("id", folderId)
        .eq("tenant_id", tenantId)
        .maybeSingle();

      if (folderError || !folder) {
        return NextResponse.json(
          { error: "Target folder not found or access denied" },
          { status: 404 }
        );
      }
    }

    const updates: Record<string, unknown> = {};
    if (workspaceId) updates.workspace_id = workspaceId;
    // Explicit null clears the folder ("unfiled"); a non-empty value files it.
    if (folderId !== undefined) updates.folder_id = folderId === "" ? null : folderId;

    const { data: updated, error: updateError } = await supabase
      .from("media_assets")
      .update(updates)
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .select("id, url, prompt, workspace_id, folder_id, created_at")
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