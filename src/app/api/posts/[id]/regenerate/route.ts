import { NextRequest, NextResponse } from "next/server";
import { getTenantId, requireRole } from "@/lib/auth";
import { getCurrentWorkspaceId } from "@/lib/workspace";
import { regenerateBlogPost } from "@/lib/ai/team-task";

/**
 * POST /api/posts/[id]/regenerate
 *
 * Rebuild a blog post through Cheryl's real pipeline and overwrite the post
 * in place. An optional `feedback` body guides the rewrite (the "why" the
 * owner types in the rewrite dialog), so the result matches their preferred
 * style/result. Runs synchronously; blog generation takes ~30-60s.
 *
 * Body: { feedback?: string }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const tenantId = await getTenantId();
    await requireRole("agency_editor");
    const { id } = await params;
    const workspaceId = await getCurrentWorkspaceId();

    let body: { feedback?: string } = {};
    try {
      body = (await request.json()) as { feedback?: string };
    } catch {
      // no body — plain regenerate
    }
    const feedback =
      typeof body.feedback === "string" && body.feedback.trim()
        ? body.feedback.trim()
        : undefined;

    const result = await regenerateBlogPost(tenantId, id, workspaceId, feedback);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
