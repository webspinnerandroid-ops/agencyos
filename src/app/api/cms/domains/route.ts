import { NextRequest, NextResponse } from "next/server";
import { getTenantId, requireRole } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Custom domain mapping for CMS sites.
 * Each row maps a domain (client.com or client.platform.example) to the slug
 * of a site_pages page. The platform's middleware rewrites requests whose Host
 * matches a mapped domain to /site/<slug>; DNS + the web server must point the
 * domain at this app (see scripts/sync-site-domains.cjs).
 */

const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

export async function GET() {
  try {
    const tenantId = await getTenantId();
    await requireRole("agency_admin");
    const supabase = await createServiceClient();
    const { data, error } = await supabase
      .from("site_domains")
      .select("id, tenant_id, domain, site_slug, created_at")
      .eq("tenant_id", tenantId)
      .order("domain", { ascending: true });
    if (error) throw new Error(error.message);
    return NextResponse.json({ domains: data ?? [] });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message ?? "Failed to load domains" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    await requireRole("agency_admin");
    const body = (await request.json().catch(() => ({}))) as {
      domain?: string;
      siteSlug?: string;
    };
    const domain = (body.domain ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
    const siteSlug = (body.siteSlug ?? "").trim().replace(/^\/site\//, "");
    if (!DOMAIN_RE.test(domain)) {
      return NextResponse.json({ error: "Enter a valid domain, e.g. client.com" }, { status: 400 });
    }
    if (!siteSlug) {
      return NextResponse.json({ error: "Choose a site page" }, { status: 400 });
    }

    const supabase = await createServiceClient();

    // The mapped site page must exist for this tenant.
    const { data: page } = await supabase
      .from("site_pages")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("slug", siteSlug)
      .maybeSingle();
    if (!page) {
      return NextResponse.json({ error: "No site page with that slug in this workspace" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("site_domains")
      .insert({ tenant_id: tenantId, domain, site_slug: siteSlug })
      .select("*")
      .single();
    if (error) {
      return NextResponse.json(
        { error: /duplicate/i.test(error.message) ? "That domain is already mapped" : error.message },
        { status: 400 }
      );
    }
    return NextResponse.json({ domain: data }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message ?? "Failed to add domain" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    await requireRole("agency_admin");
    const id = request.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Missing domain id" }, { status: 400 });

    const supabase = await createServiceClient();
    const { error } = await supabase
      .from("site_domains")
      .delete()
      .eq("id", id)
      .eq("tenant_id", tenantId);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message ?? "Failed to remove domain" },
      { status: 500 }
    );
  }
}
