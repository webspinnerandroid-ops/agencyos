import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { createClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/encryption";
import { buildAuthHeader, listSiteContent } from "@/lib/publishing/wordpressPublisher";

/**
 * GET /api/wordpress/site-content?siteId=<blogPlatformId>&kind=post|page&search=...
 *
 * Returns the existing posts (or pages) on ONE connected WordPress site so
 * the Generate Content page can offer "overwrite existing" targets. Reads
 * the site's /wp-json/wp/v2/posts (or /pages) with the same stored
 * credentials the publisher uses. The platform row is fetched tenant-scoped;
 * best-effort (unreachable/misconfigured sites return an empty list).
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

    const { data: bp, error } = await supabase
      .from("blog_platforms")
      .select("id, site_url, site_name, encrypted_credentials")
      .eq("id", siteId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (error || !bp) {
      return NextResponse.json(
        { error: "Connected site not found" },
        { status: 404 }
      );
    }

    let credentials: Record<string, string> = {};
    try {
      if (bp.encrypted_credentials) {
        credentials = JSON.parse(decrypt(bp.encrypted_credentials) ?? "{}");
      }
    } catch {
      return NextResponse.json({ items: [] });
    }

    const authHeader = buildAuthHeader(credentials);
    if (!authHeader) {
      return NextResponse.json({ items: [] });
    }

    const items = await listSiteContent(bp.site_url, authHeader, kind, search);
    return NextResponse.json({ siteName: bp.site_name, items });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}