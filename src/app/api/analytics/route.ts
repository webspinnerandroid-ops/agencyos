import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";

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
    // tenant, optionally filtered by client and date range.
    let postQuery = supabase
      .from("posts")
      .select(
        `
        id,
        content,
        scheduled_at,
        status,
        client_id,
        post_platforms (
          id,
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
        content: post.content,
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
              content: topPost.content?.slice(0, 120) ?? "",
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