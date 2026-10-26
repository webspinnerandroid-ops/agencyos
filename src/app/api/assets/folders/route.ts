import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { getCurrentWorkspaceId } from "@/lib/workspace";
import { parseJsonBody } from "@/lib/api-validate";
import { assetFolderCreateSchema, ASSET_FOLDER_KINDS } from "@/lib/validations";

/**
 * GET /api/assets/folders
 * Lists the current workspace's asset folders (optionally filtered by kind).
 *
 * POST /api/assets/folders
 * Body: { name, kind } — creates a folder in the current workspace.
 */
export async function GET(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    const workspaceId = await getCurrentWorkspaceId();
    const supabase = await createServiceClient();

    const kind = new URL(request.url).searchParams.get("kind") ?? undefined;

    let query = supabase
      .from("asset_folders")
      .select("id, name, kind, created_at")
      .eq("tenant_id", tenantId)
      .order("name");
    if (workspaceId) query = query.eq("workspace_id", workspaceId);
    if (kind) query = query.eq("kind", kind);

    const { data, error } = await query;
    if (error) {
      return NextResponse.json(
        { error: "Failed to list folders", details: error.message },
        { status: 500 }
      );
    }
    return NextResponse.json({ folders: data ?? [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    const workspaceId = await getCurrentWorkspaceId();
    const supabase = await createServiceClient();

    const body = await parseJsonBody(request, assetFolderCreateSchema);
    if (!body.ok) return body.response;

    const name = body.data.name;
    const kind = body.data.kind;

    if (!(ASSET_FOLDER_KINDS as readonly string[]).includes(kind)) {
      return NextResponse.json({ error: `Invalid folder kind: ${kind}` }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("asset_folders")
      .insert({
        tenant_id: tenantId,
        workspace_id: workspaceId ?? null,
        name,
        kind,
      })
      .select("id, name, kind, created_at")
      .single();

    if (error) {
      return NextResponse.json(
        { error: "Failed to create folder", details: error.message },
        { status: 500 }
      );
    }
    return NextResponse.json({ folder: data }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
