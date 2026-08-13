import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { getCurrentWorkspaceId } from "@/lib/workspace";
import { slugify } from "@/lib/cms";

export async function GET() {
  try {
    const tenantId = await getTenantId();
    const supabase = await createServiceClient();
    const workspaceId = await getCurrentWorkspaceId();

    let query = supabase
      .from("site_pages")
      .select("id, tenant_id, workspace_id, client_id, title, slug, is_published, preview_token, published_at, created_at, updated_at")
      .eq("tenant_id", tenantId)
      .order("updated_at", { ascending: false });

    if (workspaceId) query = query.eq("workspace_id", workspaceId);

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ pages: data ?? [] });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    const supabase = await createServiceClient();
    const workspaceId = await getCurrentWorkspaceId();

    const body = (await request.json().catch(() => ({}))) as { title?: string; clientId?: string };
    const title = body.title?.trim() || "Untitled Page";
    let slug = slugify(title);

    // Ensure slug uniqueness within the tenant.
    const { data: existing } = await supabase
      .from("site_pages")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("slug", slug)
      .limit(1);
    if (existing && existing.length > 0) {
      slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
    }

    const { data, error } = await supabase
      .from("site_pages")
      .insert({
        tenant_id: tenantId,
        workspace_id: workspaceId ?? null,
        client_id: body.clientId ?? null,
        title,
        slug,
        blocks: [],
        is_published: false,
        preview_token: crypto.randomUUID(),
      })
      .select("*")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ page: data }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal error" },
      { status: 500 }
    );
  }
}
