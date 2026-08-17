import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { getCurrentWorkspaceId } from "@/lib/workspace";

/**
 * GET /api/assets
 * Workspace-scoped media asset library listing.
 *
 * Query params:
 *   type      — "image" | "video" | "voice" (optional)
 *   task      — "brand_design" | "image_generation" (optional; image type only)
 *   folderId  — only assets in this folder (optional)
 *   unfiled   — "1" → only assets with no folder
 *   q         — substring search on prompt
 *   limit     — page size (default 48)
 *   offset    — page offset (default 0)
 *
 * Returns { assets, total, workspaceId }.
 */
export async function GET(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    const workspaceId = await getCurrentWorkspaceId();
    const supabase = await createServiceClient();

    const url = new URL(request.url);
    const type = url.searchParams.get("type") ?? undefined;
    const task = url.searchParams.get("task") ?? undefined;
    const folderId = url.searchParams.get("folderId") ?? undefined;
    const unfiled = url.searchParams.get("unfiled") === "1";
    const q = (url.searchParams.get("q") ?? "").trim();
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "48", 10) || 48, 200);
    const offset = parseInt(url.searchParams.get("offset") ?? "0", 10) || 0;

    let query = supabase
      .from("media_assets")
      .select("id, type, task, prompt, url, thumbnail_url, folder_id, metadata, status, created_at", { count: "exact" })
      .eq("tenant_id", tenantId)
      .eq("status", "completed");

    // Workspace scoping — same fallback as the Recent Images endpoint.
    if (workspaceId) {
      query = query.eq("workspace_id", workspaceId);
    }
    if (type) query = query.eq("type", type);
    if (task) query = query.eq("task", task);
    if (folderId) query = query.eq("folder_id", folderId);
    if (unfiled) query = query.is("folder_id", null);
    if (q) query = query.ilike("prompt", `%${q}%`);

    const { data, error, count } = await query
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      return NextResponse.json(
        { error: "Failed to list assets", details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      assets: data ?? [],
      total: count ?? 0,
      workspaceId: workspaceId ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
