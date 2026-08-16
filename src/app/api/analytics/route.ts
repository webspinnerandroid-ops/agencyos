import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { getCurrentWorkspaceId } from "@/lib/workspace";
import { platformPostUrl } from "@/lib/social-links";
import {
  type ConnectionProvider,
  type ConnectionRecord,
  type TrafficSourceOption,
  getAccessToken,
  isMissingWorkspaceColumn,
  listProviderResources,
} from "@/lib/connections";

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
    const resource = searchParams.get("resource");

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

      // Where the post was published: platform assignments first, plus any
      // real platforms the metric snapshots were fetched from (older rows
      // may predate post_platforms entries). "unknown" is filtered out.
      const platformSet = new Set<string>();
      for (const pp of (post.post_platforms as unknown as Array<{
        social_accounts: { platform: string } | null;
      }> | undefined) ?? []) {
        if (pp.social_accounts?.platform) platformSet.add(pp.social_accounts.platform);
      }
      for (const s of snapshots) {
        if (s.platform && s.platform !== "unknown") platformSet.add(s.platform);
      }

      return {
        id: post.id,
        content: postContentText(post.content),
        scheduled_at: post.scheduled_at,
        client_id: post.client_id,
        platforms: [...platformSet],
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

    // Site traffic (GA4 + Search Console) from the connected sources — the
    // daily rows are written by the syncSiteMetrics Inngest job. Tenant-level
    // (site traffic isn't workspace-scoped). Degrades gracefully to an empty
    // series before the traffic_snapshots migration has been applied.
    let trafficRows: unknown[] = [];
    let hasTrafficData = false;
    try {
      // Any snapshots for this tenant at all (ignoring the date range) so the
      // UI can say "no data in this range" instead of "connect a source" when
      // the connection + rows exist but fall outside the selected dates.
      const { data: anyRows } = await supabase
        .from("traffic_snapshots")
        .select("id")
        .eq("tenant_id", tenantId)
        .limit(1);
      if (anyRows && anyRows.length > 0) hasTrafficData = true;

      let query = supabase
        .from("traffic_snapshots")
        .select("provider, resource, metric_date, sessions, users, pageviews, engagement_rate, clicks, impressions, ctr, position, fetched_at")
        .eq("tenant_id", tenantId)
        .gte("metric_date", startDate ?? "1970-01-01")
        .lte("metric_date", (endDate ?? new Date().toISOString().slice(0, 10)))
        .order("metric_date", { ascending: true });
      if (resource) {
        query = query.eq("resource", resource);
      }
      const { data, error } = await query;
      if (error) {
        if (!/does not exist|schema cache/i.test(error.message)) {
          console.error("[analytics] traffic query:", error.message);
        }
      } else {
        trafficRows = data ?? [];
      }
    } catch (err) {
      console.error("[analytics] traffic query:", (err as Error).message);
    }

    // Pickable GA4 properties / SC sites for the Traffic tab, cached in
    // available_resources at connect time. Lazily backfilled (one Google
    // call, then stored) when the cache is missing — e.g. connections made
    // before migration 054.
    const trafficSources: Record<
      ConnectionProvider,
      { active: string | null; resources: TrafficSourceOption[] }
    > = {
      google_analytics: { active: null, resources: [] },
      search_console: { active: null, resources: [] },
    };
    try {
      const workspaceId = (await getCurrentWorkspaceId().catch(() => null)) ?? null;
      let connQuery = supabase
        .from("tenant_connections")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("connected", true)
        .in("provider", ["google_analytics", "search_console"]);
      if (workspaceId) {
        connQuery = connQuery.or(
          `workspace_id.is.null,workspace_id.eq.${workspaceId}`
        );
      }
      let { data: conns, error: connErr } = await connQuery;
      // Migration 070 not applied yet — fall back to the tenant-wide list.
      if (connErr && isMissingWorkspaceColumn(connErr)) {
        const legacy = await supabase
          .from("tenant_connections")
          .select("*")
          .eq("tenant_id", tenantId)
          .eq("connected", true)
          .in("provider", ["google_analytics", "search_console"]);
        conns = legacy.data ?? [];
        connErr = legacy.error ?? null;
      }
      if (!connErr) {
        // Prefer the workspace-scoped connection over the legacy tenant-wide
        // row when both exist for a provider (multi-workspace tenants).
        const all = (conns ?? []) as ConnectionRecord[];
        const seen = new Set<string>();
        const ordered: ConnectionRecord[] = [];
        for (const c of all) {
          if (c.workspace_id === workspaceId && !seen.has(c.provider)) {
            ordered.push(c);
            seen.add(c.provider);
          }
        }
        for (const c of all) {
          if (!seen.has(c.provider)) {
            ordered.push(c);
            seen.add(c.provider);
          }
        }
        for (const conn of ordered) {
          const entry = trafficSources[conn.provider];
          entry.active = conn.selected_resource ?? null;
          if (Array.isArray(conn.available_resources) && conn.available_resources.length) {
            entry.resources = conn.available_resources;
            continue;
          }
          // Backfill the cache once (best-effort; degraded to empty list).
          try {
            const { accessToken } = await getAccessToken(conn);
            const opts = await listProviderResources(conn.provider, accessToken);
            entry.resources = opts;
            await supabase
              .from("tenant_connections")
              .update({ available_resources: opts })
              .eq("id", conn.id);
          } catch (err) {
            console.error("[analytics] sources backfill:", (err as Error).message);
          }
        }
      }
    } catch (err) {
      console.error("[analytics] traffic sources:", (err as Error).message);
    }

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
      traffic: trafficRows ?? [],
      hasTrafficData,
      trafficSources,
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