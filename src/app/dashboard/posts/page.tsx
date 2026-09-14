import { createClient } from "@supabase/supabase-js";
import { getTenantId } from "@/lib/auth";
import { fetchWithTimeout } from "@/lib/supabase/server";
import { getCurrentWorkspaceId } from "@/lib/workspace";
import { mapPublishLogsToHistory } from "@/lib/publish-history";
import PostsList from "./posts-list";
import type { PostRow } from "@/lib/post-preview";

export const dynamic = "force-dynamic";

export default async function AllPostsPage() {
  const [tenantId, workspaceId] = await Promise.all([
    getTenantId().catch(() => null),
    getCurrentWorkspaceId(),
  ]);

  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { fetch: fetchWithTimeout },
    }
  );

  // Lightweight query — only real columns, never JSON-path projections into
  // the content blob (posts carry megabytes of base64 image data; extracting
  // JSON paths forces Postgres to scan the whole blob per row and times out).
  // The full post is lazy-loaded when the detail modal is opened.
  //
  // Workspace isolation: `getCurrentWorkspaceId()` resolves the cookie AND
  // falls back to the tenant's default workspace, so workspaceId should always
  // be a concrete id for an isolated tenant. We ALWAYS bind workspace_id and
  // never run the query tenant-wide — if resolution somehow returns null we
  // return an empty list rather than leaking posts from every workspace.
  let query = db
    .from("posts")
    .select(
      "id, status, ai_generated, scheduled_at, created_at, title, type, platform, seo_score, aeo_geo_score, cms_published_at, cms_slug, auto_publish_at"
    )
    .eq("tenant_id", tenantId ?? "")
    .order("created_at", { ascending: false });

  if (workspaceId) {
    query = query.eq("workspace_id", workspaceId);
  } else {
    // No resolvable workspace — show nothing rather than all tenant posts.
    query = query.is("workspace_id", null);
  }

  const { data: posts } = await query;

  // Per-post publish history (connected-sites publishes) — join the logs to
  // the workspace-scoped post ids. Chunked so a long post list can't blow the
  // PostgREST URL length limit.
  const postIds = ((posts ?? []) as { id: string }[]).map((p) => p.id);
  const rows: Array<Record<string, unknown>> = [];
  for (let i = 0; i < postIds.length; i += 100) {
    const chunk = postIds.slice(i, i + 100);
    const { data } = await db
      .from("publishing_logs")
      .select(
        "post_id, platform, site_name, target_url, success, error_message, attempt_at"
      )
      .in("post_id", chunk)
      .order("attempt_at", { ascending: false })
      .limit(500);
    rows.push(...((data ?? []) as Array<Record<string, unknown>>));
  }
  const publishHistory = mapPublishLogsToHistory(rows, postIds);

  return (
    <PostsList
      posts={(posts ?? []) as unknown as PostRow[]}
      history={publishHistory}
    />
  );
}