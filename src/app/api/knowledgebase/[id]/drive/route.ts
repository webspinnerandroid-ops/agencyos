import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { getCurrentWorkspaceId } from "@/lib/workspace";
import { mirrorKnowledgebaseFileToDrive } from "@/lib/drive-sync";

/**
 * POST /api/knowledgebase/[id]/drive
 * Uploads a knowledgebase file's original bytes (docx, pdf, image, etc.)
 * into the workspace's attached Google Drive folder, inside a per-client
 * subfolder named after the workspace. Records the outcome on the item
 * (drive_synced_at / drive_file_id / drive_error) so the UI can show a sync
 * badge and offer a one-click retry.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const tenantId = await getTenantId();
    const workspaceId = await getCurrentWorkspaceId().catch(() => null);
    const supabase = await createServiceClient();
    const { id } = await params;

    const { data: item, error: itemErr } = await supabase
      .from("knowledgebase_items")
      .select("id, tenant_id, workspace_id, name, original_filename, storage_path, mime_type")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (itemErr || !item) {
      return NextResponse.json(
        { error: "Knowledgebase item not found or access denied" },
        { status: 404 }
      );
    }
    if (!item.storage_path) {
      return NextResponse.json(
        { error: "This item has no stored file (it may be a URL or pasted text)." },
        { status: 400 }
      );
    }

    const result = await mirrorKnowledgebaseFileToDrive({
      tenantId,
      workspaceId: item.workspace_id ?? workspaceId,
      itemId: item.id,
      storagePath: item.storage_path,
      name: item.original_filename || item.name || "knowledgebase-file",
      mime: item.mime_type || "application/octet-stream",
    });

    if (!result.saved) {
      const status = /could not read stored file/.test(result.skipped ?? "") ? 500 : 400;
      return NextResponse.json(
        { error: result.skipped ?? "Failed to save to Google Drive" },
        { status }
      );
    }

    return NextResponse.json({ success: true, file: result.file });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
