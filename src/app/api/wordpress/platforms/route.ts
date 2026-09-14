import { NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { createClient } from "@supabase/supabase-js";
import { BUILTIN_CMS_PLATFORM_ID } from "@/lib/publishing/connectedSitesPublisher";

/**
 * GET /api/wordpress/platforms
 *
 * Lists the tenant's connected blog platforms (id / url / name / type) for
 * the "Publish to Connected Sites" dialog — plus the tenant's own built-in
 * CMS site (site_pages) as a first-class target. Tenant-scoped like the
 * publish backend (POST /api/publish/generated and POST /api/publish) so
 * connected sites show up from ANY workspace the tenant owns — a site
 * connected under the "GiantByte" workspace must still be publishable from
 * the default workspace. No live calls to the sites; this is just the row
 * list + capability flags the dialog renders.
 */
export async function GET() {
  try {
    const tenantId = await getTenantId();
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { data: platforms, error } = await supabase
      .from("blog_platforms")
      .select("id, site_url, site_name, platform_type")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json(
        { error: "Failed to fetch connected sites" },
        { status: 500 }
      );
    }

    // What each platform type can do — drives the dialog's Action + Replace
    // selects (Medium's API only creates; Ghost/Webflow have one content
    // model; WordPress and the built-in CMS have posts + pages).
    const caps: Record<
      string,
      { supportsOverwrite: boolean; kinds: ("post" | "page")[] }
    > = {
      wordpress: { supportsOverwrite: true, kinds: ["post", "page"] },
      wordpress_jetpack: { supportsOverwrite: true, kinds: ["post", "page"] },
      ghost: { supportsOverwrite: true, kinds: ["post"] },
      webflow: { supportsOverwrite: true, kinds: ["post"] },
      medium: { supportsOverwrite: false, kinds: ["post"] },
      builtin_cms: { supportsOverwrite: true, kinds: ["post", "page"] },
    };

    const list = (platforms ?? []).map((p) => {
      const c = caps[p.platform_type] ?? {
        supportsOverwrite: false,
        kinds: ["post"] as ("post" | "page")[],
      };
      return {
        id: p.id,
        siteUrl: p.site_url,
        siteName: p.site_name || p.site_url,
        platformType: p.platform_type,
        supportsOverwrite: c.supportsOverwrite,
        kinds: c.kinds,
      };
    });

    // The tenant's own site is always a target (built-in CMS / site_pages).
    list.unshift({
      id: BUILTIN_CMS_PLATFORM_ID,
      siteUrl: process.env.PUBLIC_SITE_URL ?? "/site",
      siteName: "Built-in website (CMS)",
      platformType: "builtin_cms",
      supportsOverwrite: true,
      kinds: ["post", "page"],
    });

    return NextResponse.json({ platforms: list });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}