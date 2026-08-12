import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { resolveAeoGeoScore } from "@/lib/aeo-geo";

/**
 * POST /api/posts/[id]/aeo-geo
 * Body: { deep?: boolean }
 *
 * Scores a blog post for AEO/GEO readiness. Runs the free heuristic engine by
 * default; `deep: true` runs the opt-in LLM-assisted pass (falls back to the
 * heuristic if no text provider key is configured).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const tenantId = await getTenantId();
    if (!tenantId) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const deep = body?.deep === true;

    const supabase = await createServiceClient();
    const { data: post, error } = await supabase
      .from("posts")
      .select("content, title, type")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (error || !post) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    let content: any = post.content;
    if (typeof content === "string") {
      try {
        content = JSON.parse(content);
      } catch {
        content = { body: content };
      }
    }
    const bodyMd =
      typeof content === "string" ? content : (content?.body as string) ?? "";
    const metaDescription = (content?.metaDescription as string) ?? "";
    const keyword = (content?.focusKeyword as string) ?? (content?.keyword as string) ?? (content?.topic as string) ?? "";

    if (!bodyMd || !bodyMd.trim()) {
      return NextResponse.json(
        { error: "This post has no body content to score." },
        { status: 400 }
      );
    }

    const { result, source } = await resolveAeoGeoScore(
      {
        title: post.title ?? "",
        metaDescription,
        body: bodyMd,
        keyword,
      },
      { tenantId, useLlm: deep }
    );

    return NextResponse.json({ result, source });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Internal error" },
      { status: 500 }
    );
  }
}
