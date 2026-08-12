import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { createClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/encryption";

/**
 * GET /api/wordpress/categories
 *
 * Returns the categories available on the tenant's connected WordPress
 * sites, so the publish dialog can let the user pick which category a post
 * goes into (instead of publishing into "Uncategorized"). Reads each
 * site's /wp-json/wp/v2/categories with the same stored credentials the
 * publisher uses. Best-effort: a site that errors is skipped, not fatal.
 */
export async function GET(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { data: blogPlatforms, error } = await supabase
      .from("blog_platforms")
      .select("*")
      .eq("tenant_id", tenantId);

    if (error) {
      return NextResponse.json(
        { error: "Failed to fetch blog platforms", details: error },
        { status: 500 }
      );
    }

    const wpPlatforms = (blogPlatforms ?? []).filter(
      (p) =>
        p.platform_type === "wordpress" || p.platform_type === "wordpress_jetpack"
    );

    const sites: {
      blogPlatformId: string;
      siteUrl: string;
      siteName: string;
      categories: { id: number; name: string; slug: string; count: number }[];
    }[] = [];

    for (const bp of wpPlatforms) {
      let credentials: Record<string, string> = {};
      try {
        if (bp.encrypted_credentials) {
          credentials = JSON.parse(decrypt(bp.encrypted_credentials) ?? "{}");
        }
      } catch {
        continue;
      }

      let authHeader = "";
      if (credentials.username && credentials.applicationPassword) {
        const encoded = Buffer.from(
          `${credentials.username}:${credentials.applicationPassword}`
        ).toString("base64");
        authHeader = `Basic ${encoded}`;
      } else if (credentials.apiToken) {
        authHeader = `Bearer ${credentials.apiToken}`;
      } else if (credentials.apiKey) {
        authHeader = `Bearer ${credentials.apiKey}`;
      }

      try {
        const apiUrl =
          bp.site_url.replace(/\/$/, "") + "/wp-json/wp/v2/categories?per_page=100&orderby=count&order=desc";
        const res = await fetch(apiUrl, {
          headers: authHeader ? { Authorization: authHeader } : {},
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) continue;
        const categories = (await res.json()) as {
          id: number;
          name: string;
          slug: string;
          count: number;
        }[];
        sites.push({
          blogPlatformId: bp.id,
          siteUrl: bp.site_url,
          siteName: bp.site_name || bp.site_url,
          categories: Array.isArray(categories) ? categories : [],
        });
      } catch {
        // Skip unreachable sites — not fatal.
      }
    }

    return NextResponse.json({ sites });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
