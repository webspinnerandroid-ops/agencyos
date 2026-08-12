import { NextRequest, NextResponse } from "next/server";
import { getTenantId, requireRole } from "@/lib/auth";
import { getCurrentWorkspaceId } from "@/lib/workspace";
import { regenerateBlogPost } from "@/lib/ai/team-task";

/**
 * POST /api/posts/[id]/regenerate
 *
 * Rebuild a broken/empty blog post (body came back empty, legacy placeholder
 * drafts) through Cheryl's real pipeline and overwrite the post in place.
 * Runs synchronously; blog generation takes ~30-60s. Tenant + role guarded.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const tenantId = await getTenantId();
    await requireRole("agency_editor");
    const { id } = await params;
    const workspaceId = await getCurrentWorkspaceId();

    const result = await regenerateBlogPost(tenantId, id, workspaceId);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
