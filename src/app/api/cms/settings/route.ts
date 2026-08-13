import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { getCurrentWorkspaceId } from "@/lib/workspace";
import { createServiceClient } from "@/lib/supabase/server";
import { THEME_PRESETS, type CmsBlock } from "@/lib/cms";

export interface SiteNavItem {
  label: string;
  href: string;
}

export interface SiteSettings {
  id?: string;
  site_name: string;
  tagline: string;
  logo_url: string | null;
  header_blocks: CmsBlock[];
  footer_blocks: CmsBlock[];
  site_nav: SiteNavItem[];
  global_css: string;
  theme_preset: string;
}

/** Keep only sane { label, href } menu entries. */
export function sanitizeSiteNav(raw: unknown): SiteNavItem[] {
  if (!Array.isArray(raw)) return [];
  const out: SiteNavItem[] = [];
  for (const it of raw) {
    if (!it || typeof it !== "object") continue;
    const item = it as Record<string, unknown>;
    const label = typeof item.label === "string" ? item.label.trim() : "";
    const href = typeof item.href === "string" ? item.href.trim() : "";
    if (!label || !href) continue;
    // Allow /site/<slug> pages or external http(s) links only.
    if (href.startsWith("/site/") || /^https?:\/\//.test(href)) {
      out.push({ label: label.slice(0, 60), href: href.slice(0, 500) });
    }
  }
  return out;
}

/** GET /api/cms/settings — current tenant's sitewide settings (or defaults). */
export async function GET() {
  try {
    const tenantId = await getTenantId();
    if (!tenantId) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const workspaceId = (await getCurrentWorkspaceId().catch(() => null)) ?? null;
    const supabase = await createServiceClient();

    const { data } = await supabase
      .from("cms_site_settings")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    return NextResponse.json({
      settings: data ?? {
        site_name: "My Site",
        tagline: "",
        logo_url: null,
        header_blocks: [],
        footer_blocks: [],
        site_nav: [],
        global_css: "",
        theme_preset: "clean",
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Internal error" }, { status: 500 });
  }
}

/** PUT /api/cms/settings — upsert sitewide settings for this tenant+workspace. */
export async function PUT(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    if (!tenantId) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const workspaceId = (await getCurrentWorkspaceId().catch(() => null)) ?? null;
    const body = (await request.json().catch(() => ({}))) as Partial<SiteSettings>;

    const preset = body.theme_preset && body.theme_preset in THEME_PRESETS ? body.theme_preset : "clean";
    const record = {
      tenant_id: tenantId,
      workspace_id: workspaceId,
      site_name: String(body.site_name ?? "").slice(0, 120) || "My Site",
      tagline: String(body.tagline ?? "").slice(0, 300),
      logo_url: body.logo_url ? String(body.logo_url).slice(0, 2000) : null,
      header_blocks: Array.isArray(body.header_blocks) ? body.header_blocks : [],
      footer_blocks: Array.isArray(body.footer_blocks) ? body.footer_blocks : [],
      site_nav: sanitizeSiteNav(body.site_nav),
      global_css: String(body.global_css ?? "").slice(0, 20_000),
      theme_preset: preset,
      updated_at: new Date().toISOString(),
    };

    const supabase = await createServiceClient();
    const { data: existing } = await supabase
      .from("cms_site_settings")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (existing?.id) {
      const { data, error } = await supabase
        .from("cms_site_settings")
        .update(record)
        .eq("id", existing.id)
        .select("*")
        .single();
      if (error) throw error;
      return NextResponse.json({ settings: data });
    }

    const { data, error } = await supabase
      .from("cms_site_settings")
      .insert(record)
      .select("*")
      .single();
    if (error) throw error;
    return NextResponse.json({ settings: data });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Internal error" }, { status: 500 });
  }
}
