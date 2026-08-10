import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * POST /api/media-assets/[id]/duplicate
 * Copies an image asset into another workspace of the same tenant.
 * Body: { workspaceId }
 */
export async function POST(
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

    // Verify the source asset belongs to this tenant
    const { data: source, error: fetchError } = await supabase
      .from("media_assets")
      .select("*")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .single();

    if (fetchError || !source) {
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

    // Insert a copy into the target workspace
    const { data: copy, error: insertError } = await supabase
      .from("media_assets")
      .insert({
        tenant_id: tenantId,
        workspace_id: workspaceId,
        client_id: source.client_id ?? null,
        type: source.type ?? "image",
        provider: source.provider ?? null,
        model: source.model ?? null,
        prompt: source.prompt,
        url: source.url,
        thumbnail_url: source.thumbnail_url ?? null,
        metadata: source.metadata ?? {},
        status: source.status ?? "completed",
        tags: source.tags ?? [],
      })
      .select("id, url, prompt, workspace_id, created_at")
      .single();

    if (insertError) {
      return NextResponse.json(
        { error: "Failed to duplicate asset", details: insertError },
        { status: 500 }
      );
    }

    return NextResponse.json({ asset: copy }, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}