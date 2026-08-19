import { NextRequest, NextResponse } from "next/server";
import { getRole } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import {
  sanitizePostSlug,
  slugifyTitle,
  deriveExcerpt,
} from "@/lib/site-blog";

/**
 * GET /api/admin/site-blog — list all marketing-site blog posts (any status).
 * POST /api/admin/site-blog — create a post (draft by default).
 * Both require the super admin role (the page is also behind the admin layout).
 */
export async function GET() {
  try {
    const role = await getRole();
    if (role !== "super_admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const supabase = await createServiceClient();
    const { data, error } = await supabase
      .from("site_blog_posts")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ posts: data ?? [] });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Internal error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const role = await getRole();
    if (role !== "super_admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const body = await request.json();
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }
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
    const postBody = typeof body.body === "string" ? body.body : "";
    const excerpt =
      typeof body.excerpt === "string" && body.excerpt.trim()
        ? body.excerpt.trim().slice(0, 300)
        : deriveExcerpt(postBody, title);

    const supabase = await createServiceClient();
    const { data: existing } = await supabase
      .from("site_blog_posts")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();
    if (existing) {
      return NextResponse.json(
        { error: `A post with slug "${slug}" already exists.` },
        { status: 409 }
      );
    }

    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from("site_blog_posts")
      .insert({
        slug,
        title,
        excerpt: excerpt || null,
        body: postBody,
        featured_image_url:
          typeof body.featuredImageUrl === "string"
            ? body.featuredImageUrl.trim() || null
            : null,
        status: body.status === "published" ? "published" : "draft",
        published_at: body.status === "published" ? now : null,
        created_at: now,
        updated_at: now,
      })
      .select()
      .single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ post: data }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Internal error" },
      { status: 500 }
    );
  }
}
