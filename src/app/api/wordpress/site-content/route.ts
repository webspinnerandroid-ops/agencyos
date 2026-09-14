import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { createClient } from "@supabase/supabase-js";
import {
  BUILTIN_CMS_PLATFORM_ID,
  listSiteContentForPlatform,
} from "@/lib/publishing/connectedSitesPublisher";

/**
 * GET /api/wordpress/site-content?siteId=<blogPlatformId>&kind=post|page&search=...
 *
 * Returns the existing posts (or pages) on ONE connected site so the
 * "Publish to Connected Sites" dialog can offer "overwrite existing" targets.
 * Reads the site through its own API with the same stored credentials the
 * publisher uses:
 *
 *   wordpress* → /wp-json/wp/v2/posts|pages
 *   ghost      → Ghost Admin API posts
 *   webflow    → Webflow CMS items (blog collection)
 *   builtin_cms→ this app's site_pages (tenant-scoped DB rows)
 *
 * The platform row is fetched tenant-scoped; best-effort (unreachable or
 * misconfigured sites return an empty list).
 */
export async function GET(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    const siteId = request.nextUrl.searchParams.get("siteId");
    const kindParam = request.nextUrl.searchParams.get("kind");
    const search = request.nextUrl.searchParams.get("search") ?? undefined;

    if (!siteId) {
      return NextResponse.json(
        { error: "siteId is required" },
        { status: 400 }
      );
    }
    const kind: "post" | "page" = kindParam === "page" ? "page" : "post";

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // ---- Built-in CMS: list the tenant's own site_pages rows ----
    if (siteId === BUILTIN_CMS_PLATFORM_ID) {
      const dbKind = kind === "page" ? "page" : "blog_post";
      let query = supabase
        .from("site_pages")
        .select("id, title, slug, kind, published_at, updated_at")
        .eq("tenant_id", tenantId)
        .eq("kind", dbKind)
        .order("updated_at", { ascending: false })
        .limit(100);
      if (search && search.trim()) {
        query = query.or(
          `title.ilike.%${search.trim()}%,slug.ilike.%${search.trim()}%`
        );
      }
      const { data, error } = await query;
      if (error) {
        return NextResponse.json(
          { error: "Failed to list built-in CMS pages" },
          { status: 500 }
        );
      }
      return NextResponse.json({
        siteName: "Built-in website",
        items: (data ?? []).map((p) => ({
          id: p.id,
          title: p.title,
          slug: p.slug,
          link: `/site/${p.slug}`,
          date: p.published_at ?? p.updated_at ?? null,
        })),
      });
    }

    // ---- Connected platform row ----
    const { data: bp, error } = await supabase
      .from("blog_platforms")
      .select("id, site_url, site_name, platform_type, encrypted_credentials")
      .eq("id", siteId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (error || !bp) {
      return NextResponse.json(
        { error: "Connected site not found" },
        { status: 404 }
      );
    }

    const items = await listSiteContentForPlatform(
      bp.platform_type as string,
      bp,
      kind,
      search
    );
    return NextResponse.json({ siteName: bp.site_name, items });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}