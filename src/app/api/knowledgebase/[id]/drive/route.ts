import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { getCurrentWorkspaceId } from "@/lib/workspace";
import { resolveWorkspaceDriveConnection, uploadBufferToDrive } from "@/lib/drive-sync";

/**
 * POST /api/knowledgebase/[id]/drive
 * Uploads a knowledgebase file's original bytes (docx, pdf, image, etc.)
 * into the workspace's attached Google Drive folder.
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

    const resolved = await resolveWorkspaceDriveConnection(
      tenantId,
      item.workspace_id ?? workspaceId
    );
    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.error }, { status: 400 });
    }

    const { data: blob, error: dlErr } = await supabase.storage
      .from("tenant-assets")
      .download(item.storage_path);
    if (dlErr || !blob) {
      return NextResponse.json(
        { error: `Could not read the stored file: ${dlErr?.message ?? "not found"}` },
        { status: 500 }
      );
    }

    const buffer = Buffer.from(await blob.arrayBuffer());
    const name = item.original_filename || item.name || "knowledgebase-file";
    const mime = item.mime_type || "application/octet-stream";

    const file = await uploadBufferToDrive(
      resolved.folderId,
      resolved.accessToken,
      buffer,
      name,
      mime
    );

    return NextResponse.json({ success: true, file });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
