import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    const supabase = await createServiceClient();

    const { searchParams } = request.nextUrl;
    const clientId = searchParams.get("clientId");
    const status = searchParams.get("status");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");

    // PERF: never select the full `content` blob in a list query — blog bodies
    // are large and the calendar refetches this endpoint on an 8s poll while
    // items generate. Instead select the small pieces the calendar UI actually
    // reads: the denormalized `title`/`type` columns plus two JSON keys
    // (caption/aeoGeo). The detail modal lazy-loads the full body from
    // GET /api/posts/[id] when it opens.
    //
    // The response is then re-shaped into the `content` object clients read
    // (`post.content.title`, `.type`, …). Returning the projected keys flat
    // meant `post.content` was undefined for every consumer, which blanked the
    // calendar chips and the post dialog.
    let query = supabase
      .from("posts")
      .select(
        `
        id,
        title,
        type,
        content->caption,
        content->aeoGeo,
        media_urls,
        scheduled_at,
        status,
        created_by,
        approved_by,
        ai_generated,
        tier_level,
        client_id,
        revision_reason,
        seo_score,
        seo_checks,
        aeo_geo_score,
        post_platforms (
          id,
          social_account_id,
          social_accounts (
            id,
            platform
          )
        )
      `
      )
      .eq("tenant_id", tenantId);

    // `unscheduled=1` returns the backlog: posts with no scheduled_at at all.
    // Date-window params don't apply to a null column, so they are skipped in
    // this mode. The calendar's "Unscheduled backlog" strip consumes this
    // list — newest drafts first, hard cap keeps the strip payload small.
    const unscheduled = searchParams.get("unscheduled") === "1";
    if (unscheduled) {
      query = query
        .is("scheduled_at", null)
        .order("created_at", { ascending: false })
        .limit(50);
    } else {
      query = query.order("scheduled_at", { ascending: true });
    }

    if (clientId) {
      query = query.eq("client_id", clientId);
    }

    if (status) {
      query = query.eq("status", status);
    }

    if (startDate && !unscheduled) {
      query = query.gte("scheduled_at", startDate);
    }

    if (endDate && !unscheduled) {
      query = query.lte("scheduled_at", endDate);
    }

    const { data: posts, error } = await query;

    if (error) {
      return NextResponse.json(
        { error: "Failed to fetch posts", details: error },
        { status: 500 }
      );
    }

    // Broken-blog detection without shipping bodies: let Postgres test the
    // JSON field directly and return only the ids (same criteria as the UI's
    // old isBrokenBlogPost — a blog whose body is missing or empty).
    const { data: brokenRows } = await supabase
      .from("posts")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("content->>type", "blog")
      .or("content->>body.is.null,content->>body.eq.\"\"");
    const brokenBlogIds = new Set((brokenRows ?? []).map((r) => r.id));

    return NextResponse.json({
      posts: (posts ?? []).map((p) => {
        const { type, title, caption, aeoGeo, ...rest } = p as Record<string, unknown>;
        return {
          ...rest,
          content: {
            type: type ?? null,
            title: title ?? null,
            caption: caption ?? null,
            aeoGeo: aeoGeo ?? null,
          },
          brokenBlog: brokenBlogIds.has(p.id),
        };
      }),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}