import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { getCurrentWorkspaceId } from "@/lib/workspace";
import { createServiceClient } from "@/lib/supabase/server";
import { THEME_PRESETS, type CmsBlock } from "@/lib/cms";

export interface SiteSettings {
  id?: string;
  site_name: string;
  tagline: string;
  header_blocks: CmsBlock[];
  footer_blocks: CmsBlock[];
  global_css: string;
  theme_preset: string;
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
        header_blocks: [],
        footer_blocks: [],
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
      header_blocks: Array.isArray(body.header_blocks) ? body.header_blocks : [],
      footer_blocks: Array.isArray(body.footer_blocks) ? body.footer_blocks : [],
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
