import { NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { getCurrentWorkspaceId } from "@/lib/workspace";

/**
 * GET /api/generate-image/recent
 *
 * Returns the 20 most recent completed image generations scoped to the
 * current workspace so images don't leak across workspaces.
 */
export async function GET() {
  try {
    const tenantId = await getTenantId();
    const workspaceId = await getCurrentWorkspaceId();
    const supabase = await createServiceClient();

    // metadata is heavy JSON not needed for the thumbnail list — omitting it
    // keeps the payload small as the asset count grows.
    let query = supabase
      .from("media_assets")
      .select("id, url, prompt, created_at", { count: "exact" })
      .eq("tenant_id", tenantId)
      .eq("type", "image")
      .eq("status", "completed");

    // middleware() sets the workspace_id cookie for tenants with a default
    // workspace, and getCurrentWorkspaceId() falls back to it, so this is
    // normally a live workspace id. A tenant without workspaces genuinely is
    // tenant-wide — fall back to no workspace filter rather than the
    // index-defeating .is("workspace_id", null).
    if (workspaceId) {
      query = query.eq("workspace_id", workspaceId);
    }

    const { data: assets, error, count } = await query
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) {
      console.error("[recent-images] Query error:", error.message, error.code, error.details);
      return NextResponse.json(
        { error: "Failed to fetch recent images", details: error.message },
        { status: 500 }
      );
    }

    console.log(`[recent-images] Found ${count ?? 0} images for tenant ${tenantId}`);
    return NextResponse.json({ assets: assets ?? [], total: count ?? 0 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}