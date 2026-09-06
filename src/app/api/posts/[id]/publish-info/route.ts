import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { buildSavedPostPublishPayload } from "@/lib/publishing/wordpressPublisher";

/**
 * GET /api/posts/[id]/publish-info
 *
 * Lightweight payload for the "Publish to Connected Sites" dialog when
 * publishing a SAVED post (the Publish button flow): the title plus the
 * post's images (media_urls + inline body images), so the dialog can show
 * the image toggle and upload/replace images. The full content is rebuilt
 * server-side by POST /api/publish (platform=connected_sites) — the client
 * never sends the body.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const tenantId = await getTenantId();
    const { id } = await params;
    const supabase = await createServiceClient();
    const { data: post } = await supabase
      .from("posts")
      .select("title, content, media_urls")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (!post) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    const built = buildSavedPostPublishPayload(post);
    return NextResponse.json({
      title: built?.content.title ?? post.title ?? "Untitled Post",
      images: built?.content.images ?? [],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}