import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { getCurrentWorkspaceId } from "@/lib/workspace";
import { platformPostUrl } from "@/lib/social-links";

/** Post content is a JSON blob (blog) or a string (social) — normalize to text. */
function postContentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (content && typeof content === "object") {
    const c = content as Record<string, unknown>;
    if (typeof c.title === "string" && c.title) return c.title;
    if (typeof c.caption === "string" && c.caption) return c.caption;
    if (typeof c.body === "string" && c.body) return c.body;
  }
  return "";
}

function topPostExcerpt(content: unknown): string {
  return postContentText(content).slice(0, 120) ?? "";
}

export async function GET(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    const supabase = await createServiceClient();

    const { searchParams } = request.nextUrl;
    const clientId = searchParams.get("clientId");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    const postId = searchParams.get("postId");

    // If a specific post ID is requested, return snapshots for that post only
    if (postId) {
      const { data: snapshots, error } = await supabase
        .from("analytics_snapshots")
        .select(
          `
          id,
          post_id,
          platform,
          likes,
          comments,
          shares,
          impressions,
          reach,
          fetched_at
        `
        )
        .eq("post_id", postId)
        .order("fetched_at", { ascending: true });

      if (error) {
        return NextResponse.json(
          { error: "Failed to fetch post analytics", details: error },
          { status: 500 }
        );
      }

      return NextResponse.json({ snapshots: snapshots ?? [] });
    }

    // Otherwise, build an aggregate query for all published posts within the
    // tenant, optionally filtered by client and date range. When a workspace
    // is active (x-workspace-id / cookie), the dashboard is scoped to it so
    // each workspace sees its own numbers — same model as the calendar.
    let postQuery = supabase
      .from("posts")
      .select(
        `
        id,
        content,
        scheduled_at,
        status,
        client_id,
        workspace_id,
        post_platforms (
          id,
          platform_post_id,
          platform_post_url,
          social_accounts (
            id,
            platform
          )
        ),
        analytics_snapshots (
          id,
          platform,
          likes,
          comments,
          shares,
          impressions,
          reach,
          fetched_at
        )
      `
      )
      .eq("tenant_id", tenantId)
      .eq("status", "published")
      .order("scheduled_at", { ascending: true });

    const workspaceId = await getCurrentWorkspaceId();
    if (workspaceId) {
      // Same model as /api/clients: legacy posts with workspace_id = NULL
      // appear in every workspace view, alongside posts scoped to this one.
      postQuery = postQuery.or(
        `workspace_id.is.null,workspace_id.eq.${workspaceId}`
      );
    }

    if (clientId) {
      postQuery = postQuery.eq("client_id", clientId);
    }

    if (startDate) {
      postQuery = postQuery.gte("scheduled_at", startDate);
    }

    if (endDate) {
      postQuery = postQuery.lte("scheduled_at", endDate);
    }

    const { data: posts, error } = await postQuery;

    if (error) {
      return NextResponse.json(
        { error: "Failed to fetch analytics", details: error },
        { status: 500 }
      );
    }

    // Aggregate metrics across snapshots per post
    const enriched = (posts ?? []).map((post) => {
      const snapshots = post.analytics_snapshots ?? [];

      // Link straight to the live post on each platform it was published to
      // (canonical URL when stored, else derived from the platform post id).
      const links = ((post.post_platforms as unknown as Array<{
        platform_post_id: string | null;
        platform_post_url: string | null;
        social_accounts: { platform: string } | null;
      }> | undefined) ?? [])
        .map((pp) => {
          const platform = pp.social_accounts?.platform;
          if (!platform) return null;
          const url = platformPostUrl(platform, pp.platform_post_id, pp.platform_post_url);
          return url ? { platform, url } : null;
        })
        .filter((l): l is { platform: string; url: string } => l !== null);
      const totalLikes = snapshots.reduce(
        (sum: number, s: { likes: number }) => sum + (s.likes ?? 0),
        0
      );
      const totalComments = snapshots.reduce(
        (sum: number, s: { comments: number }) => sum + (s.comments ?? 0),
        0
      );
      const totalShares = snapshots.reduce(
        (sum: number, s: { shares: number }) => sum + (s.shares ?? 0),
        0
      );
      const totalImpressions = snapshots.reduce(
        (sum: number, s: { impressions: number }) =>
          sum + (s.impressions ?? 0),
        0
      );
      const totalReach = snapshots.reduce(
        (sum: number, s: { reach: number }) => sum + (s.reach ?? 0),
        0
      );
      const engagementRate =
        totalImpressions > 0
          ? ((totalLikes + totalComments + totalShares) / totalImpressions) * 100
          : 0;

      return {
        id: post.id,
        content: postContentText(post.content),
        scheduled_at: post.scheduled_at,
        client_id: post.client_id,
        platforms:
          (post.post_platforms as unknown as Array<{
            social_accounts: { platform: string } | null;
          }> | undefined)
            ?.map(
              (pp) => pp.social_accounts?.platform
            )
            .filter(Boolean) ?? [],
        links,
        totalLikes,
        totalComments,
        totalShares,
        totalImpressions,
        totalReach,
        engagementRate: Math.round(engagementRate * 100) / 100,
        snapshots,
      };
    });

    // Compute summary
    const totalPosts = enriched.length;
    const totalLikes = enriched.reduce((s, p) => s + p.totalLikes, 0);
    const totalComments = enriched.reduce((s, p) => s + p.totalComments, 0);
    const totalShares = enriched.reduce((s, p) => s + p.totalShares, 0);
    const totalImpressions = enriched.reduce((s, p) => s + p.totalImpressions, 0);
    const totalEngagement =
      totalLikes + totalComments + totalShares;
    const avgEngagementRate =
      totalImpressions > 0
        ? (totalEngagement / totalImpressions) * 100
        : 0;

    // Top performing post (by engagement)
    const topPost = enriched.length > 0
      ? enriched.reduce((best, p) =>
          p.totalLikes + p.totalComments + p.totalShares >
          best.totalLikes + best.totalComments + best.totalShares
            ? p
            : best
        )
      : null;

    return NextResponse.json({
      posts: enriched,
      workspaceId: workspaceId ?? null,
      summary: {
        totalPosts,
        totalLikes,
        totalComments,
        totalShares,
        totalImpressions,
        totalEngagement,
        avgEngagementRate: Math.round(avgEngagementRate * 100) / 100,
        topPost: topPost
          ? {
              id: topPost.id,
              content: topPostExcerpt(topPost.content),
              totalLikes: topPost.totalLikes,
              totalComments: topPost.totalComments,
              totalShares: topPost.totalShares,
            }
          : null,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}