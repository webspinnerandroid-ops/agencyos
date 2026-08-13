import { createClient } from "@supabase/supabase-js";
import { getTenantId } from "@/lib/auth";
import PostsList from "./posts-list";
import type { PostRow } from "@/lib/post-preview";

export const dynamic = "force-dynamic";

export default async function AllPostsPage() {
  const tenantId = await getTenantId().catch(() => null);

  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // Lightweight query — only real columns, never JSON-path projections into
  // the content blob (posts carry megabytes of base64 image data; extracting
  // JSON paths forces Postgres to scan the whole blob per row and times out).
  // The full post is lazy-loaded when the detail modal is opened.
  const { data: posts } = await db
    .from("posts")
    .select(
      "id, status, ai_generated, scheduled_at, created_at, title, type, platform, seo_score, aeo_geo_score, cms_published_at, cms_slug"
    )
    .eq("tenant_id", tenantId ?? "")
    .order("created_at", { ascending: false });

  return (
    <PostsList posts={(posts ?? []) as unknown as PostRow[]} />
  );
}
