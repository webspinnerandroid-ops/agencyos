import Link from "next/link";
import { createClient } from "@supabase/supabase-js";
import { formatShortDate } from "@/lib/post-preview";
import {
  siteScoreBadgeClass,
  type SiteBlogPost,
} from "@/lib/site-blog";

export const dynamic = "force-dynamic";

/**
 * /blog — the marketing site's blog archive. Lists published posts with their
 * featured image, excerpt, and date. Managed by the super admin in
 * /dashboard/admin/blog.
 */
export default async function BlogArchivePage() {
  let posts: SiteBlogPost[] = [];
  try {
    const db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
    const { data } = await db
      .from("site_blog_posts")
      .select("*")
      .eq("status", "published")
      .order("published_at", { ascending: false });
    posts = (data ?? []) as unknown as SiteBlogPost[];
  } catch {
    posts = [];
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-4">
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            ← Back to home
          </Link>
          <span className="text-sm font-semibold ml-auto">Blog</span>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-12">
        <h1 className="text-3xl font-bold tracking-tight mb-2">Blog</h1>
        <p className="text-muted-foreground mb-10">
          News, guides, and updates from the team.
        </p>

        {posts.length === 0 ? (
          <div className="rounded-lg border bg-card p-12 text-center text-muted-foreground">
            <p className="text-lg font-medium mb-1">No posts yet</p>
            <p className="text-sm">Check back soon — new articles are on the way.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {posts.map((post) => (
              <Link
                key={post.id}
                href={`/blog/${post.slug}`}
                className="group rounded-xl border bg-card overflow-hidden hover:shadow-md transition-shadow flex flex-col"
              >
                {post.featured_image_url && (
                  <div className="aspect-[16/9] overflow-hidden bg-muted">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={post.featured_image_url}
                      alt={post.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                    />
                  </div>
                )}
                <div className="p-5 flex-1 flex flex-col">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="text-xs text-muted-foreground">
                      {post.published_at ? formatShortDate(post.published_at) : ""}
                    </div>
                    {(post.seo_score != null || post.aeo_geo_score != null) && (
                      <div className="ml-auto flex items-center gap-1">
                        {post.seo_score != null && (
                          <span
                            className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${siteScoreBadgeClass(post.seo_score)}`}
                            title={`On-page SEO score: ${post.seo_score}/100`}
                          >
                            SEO {post.seo_score}
                          </span>
                        )}
                        {post.aeo_geo_score != null && (
                          <span
                            className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${siteScoreBadgeClass(post.aeo_geo_score)}`}
                            title={`AEO/GEO readiness score: ${post.aeo_geo_score}/100`}
                          >
                            AEO/GEO {post.aeo_geo_score}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <h2 className="font-semibold text-lg leading-snug mb-2 group-hover:text-primary transition-colors">
                    {post.title}
                  </h2>
                  {post.excerpt && (
                    <p className="text-sm text-muted-foreground line-clamp-3 flex-1">
                      {post.excerpt}
                    </p>
                  )}
                  <span className="text-sm text-primary mt-4 inline-flex items-center gap-1">
                    Read more →
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
