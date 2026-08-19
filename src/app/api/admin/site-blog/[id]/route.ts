import { NextRequest, NextResponse } from "next/server";
import { getRole } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { sanitizePostSlug, slugifyTitle, deriveExcerpt } from "@/lib/site-blog";

/**
 * PATCH /api/admin/site-blog/[id] — update a marketing-site blog post.
 * DELETE /api/admin/site-blog/[id] — delete it.
 * Super admin only.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const role = await getRole();
    if (role !== "super_admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id } = await params;
    const body = await request.json();
    const supabase = await createServiceClient();

    const { data: existing } = await supabase
      .from("site_blog_posts")
      .select("slug, title, body, status")
      .eq("id", id)
      .maybeSingle();
    if (!existing) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    const patch: Record<string, unknown> = {};
    if (typeof body.title === "string") {
      const title = body.title.trim();
      if (!title) {
        return NextResponse.json({ error: "Title is required" }, { status: 400 });
      }
      patch.title = title;
      const rawSlug =
        typeof body.slug === "string" && body.slug.trim()
          ? body.slug.trim()
          : slugifyTitle(title);
      const slug = sanitizePostSlug(rawSlug);
      if (!slug) {
        return NextResponse.json(
          { error: "Slug may only contain lowercase letters, numbers, and dashes." },
          { status: 400 }
        );
      }
      patch.slug = slug;
    }
    if (typeof body.body === "string") {
      patch.body = body.body;
    }
    if (typeof body.excerpt === "string") {
      patch.excerpt =
        body.excerpt.trim().length > 0
          ? body.excerpt.trim().slice(0, 300)
          : deriveExcerpt(
              (patch.body as string | undefined) ?? existing.body,
              (patch.title as string | undefined) ?? existing.title
            );
    }
    if (typeof body.featuredImageUrl === "string") {
      patch.featured_image_url = body.featuredImageUrl.trim() || null;
    }
    if (typeof body.status === "string") {
      const nextStatus = body.status === "published" ? "published" : "draft";
      patch.status = nextStatus;
      patch.published_at = nextStatus === "published" ? new Date().toISOString() : null;
    }
    patch.updated_at = new Date().toISOString();

    // Slug uniqueness check (excluding this row).
    if (patch.slug) {
      const { data: clash } = await supabase
        .from("site_blog_posts")
        .select("id")
        .eq("slug", patch.slug)
        .neq("id", id)
        .maybeSingle();
      if (clash) {
        return NextResponse.json(
          { error: `A post with slug "${patch.slug}" already exists.` },
          { status: 409 }
        );
      }
    }

    const { data, error } = await supabase
      .from("site_blog_posts")
      .update(patch)
      .eq("id", id)
      .select()
      .single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ post: data });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Internal error" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const role = await getRole();
    if (role !== "super_admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id } = await params;
    const supabase = await createServiceClient();
    const { error } = await supabase
      .from("site_blog_posts")
      .delete()
      .eq("id", id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Internal error" },
      { status: 500 }
    );
  }
}
