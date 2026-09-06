import { NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { createClient } from "@supabase/supabase-js";

/**
 * GET /api/wordpress/platforms
 *
 * Lists the tenant's connected blog platforms (id / url / name / type) for
 * the "Publish to Connected Sites" dialog. Tenant-scoped like the publish
 * backend (POST /api/publish/generated and POST /api/publish) so connected
 * sites show up from ANY workspace the tenant owns — a site connected under
 * the "GiantByte" workspace must still be publishable from the default
 * workspace. No live calls to the sites; this is just the row list.
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

    return NextResponse.json({
      platforms: (platforms ?? []).map((p) => ({
        id: p.id,
        siteUrl: p.site_url,
        siteName: p.site_name || p.site_url,
        platformType: p.platform_type,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}