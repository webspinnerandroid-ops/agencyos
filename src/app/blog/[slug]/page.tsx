import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { renderBlogBody } from "@/lib/blog-render";
import { formatShortDate } from "@/lib/post-preview";
import type { SiteBlogPost } from "@/lib/site-blog";

export const dynamic = "force-dynamic";

/**
 * /blog/<slug> — a single marketing-site blog post. Renders the title,
 * published date, featured image, and the XSS-safe markdown body.
 */
export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  let post: SiteBlogPost | null = null;
  try {
    const db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
    const { data } = await db
      .from("site_blog_posts")
      .select("*")
      .eq("slug", slug)
      .eq("status", "published")
      .maybeSingle();
    post = (data as unknown as SiteBlogPost) ?? null;
  } catch {
    post = null;
  }
  if (!post) notFound();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-4">
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            ← Back to home
          </Link>
          <Link href="/blog" className="text-sm text-muted-foreground hover:text-foreground transition-colors ml-auto">
            All posts
          </Link>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-4 py-12">
        <div className="text-sm text-muted-foreground mb-3">
          {post.published_at ? formatShortDate(post.published_at) : ""}
        </div>
        <h1 className="text-3xl font-bold tracking-tight mb-8">{post.title}</h1>
        {post.featured_image_url && (
          <div className="mb-8 rounded-lg overflow-hidden border bg-muted">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={post.featured_image_url} alt={post.title} className="w-full h-auto" />
          </div>
        )}
        <article
          className="prose prose-sm max-w-none [&_p]:my-3 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:mt-8 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:mt-6 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_img]:rounded-lg [&_img]:my-4"
          dangerouslySetInnerHTML={{ __html: renderBlogBody(post.body) }}
        />
        <div className="mt-12 pt-6 border-t">
          <Link href="/blog" className="text-sm text-primary hover:underline">
            ← Back to all posts
          </Link>
        </div>
      </main>
    </div>
  );
}
