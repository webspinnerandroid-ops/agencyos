import { createClient } from "@supabase/supabase-js";
import { fetchWithTimeout } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * /blog/feed.xml — RSS 2.0 feed for the site blog.
 * Lists the 50 most recent published posts with title, link, description,
 * pubDate, and optional enclosure (featured image).
 */
export async function GET() {
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { fetch: fetchWithTimeout },
    }
  );

  const { data: posts } = await db
    .from("site_blog_posts")
    .select("id, title, slug, excerpt, body, featured_image_url, published_at")
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(50);

  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ||
    "https://platform.blissmedialab.com";
  const buildDate = new Date().toUTCString();

  const items = (posts ?? [])
    .map((p) => {
      const pubDate = p.published_at
        ? new Date(p.published_at).toUTCString()
        : buildDate;
      const description = p.excerpt || (p.body || "").slice(0, 300).replace(/\n/g, " ");
      const link = `${siteUrl}/blog/${p.slug}`;
      const imageTag = p.featured_image_url
        ? `\n    <enclosure url="${escapeXml(p.featured_image_url)}" type="image/png" length="0" />`
        : "";
      return `  <item>
    <title>${escapeXml(p.title)}</title>
    <link>${link}</link>
    <guid isPermaLink="true">${link}</guid>
    <description>${escapeXml(description)}</description>
    <pubDate>${pubDate}</pubDate>${imageTag}
  </item>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Agency OS Blog</title>
    <link>${siteUrl}/blog</link>
    <description>News, guides, and updates from Agency OS.</description>
    <language>en-us</language>
    <lastBuildDate>${buildDate}</lastBuildDate>
    <atom:link href="${siteUrl}/blog/feed.xml" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
    },
  });
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
