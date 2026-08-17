import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * PATCH /api/assets/folders/[id]
 * Body: { name } — renames a folder (tenant-scoped).
 *
 * DELETE /api/assets/folders/[id]
 * Deletes the folder; its assets' folder_id is set to NULL (assets are kept).
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
    const name = (body?.name ?? "").toString().trim();
    if (!name) {
      return NextResponse.json({ error: "Folder name is required" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("asset_folders")
      .update({ name })
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .select("id, name, kind, created_at")
      .single();

    if (error) {
      return NextResponse.json(
        { error: "Failed to rename folder", details: error.message },
        { status: 500 }
      );
    }
    return NextResponse.json({ folder: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const tenantId = await getTenantId();
    const supabase = await createServiceClient();
    const { id } = await params;

    const { error } = await supabase
      .from("asset_folders")
      .delete()
      .eq("id", id)
      .eq("tenant_id", tenantId);

    if (error) {
      return NextResponse.json(
        { error: "Failed to delete folder", details: error.message },
        { status: 500 }
      );
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
