import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { getCurrentWorkspaceId } from "@/lib/workspace";
import { createServiceClient } from "@/lib/supabase/server";

/** GET /api/outreach?status=discovered — list outreach targets for this tenant. */
export async function GET(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    if (!tenantId) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const workspaceId = (await getCurrentWorkspaceId().catch(() => null)) ?? null;
    const status = request.nextUrl.searchParams.get("status");

    const supabase = await createServiceClient();
    let query = supabase
      .from("outreach_targets")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("relevance_score", { ascending: false });
    if (workspaceId) query = query.eq("workspace_id", workspaceId);
    if (status) query = query.eq("status", status);

    const { data, error } = await query.limit(200);
    if (error) throw error;
    return NextResponse.json({ targets: data ?? [] });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Internal error" }, { status: 500 });
  }
}

/** POST /api/outreach — manually add a target. */
export async function POST(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    if (!tenantId) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const workspaceId = (await getCurrentWorkspaceId().catch(() => null)) ?? null;
    const body = (await request.json().catch(() => ({}))) as Record<string, any>;

    const blogUrl = String(body.blog_url ?? "").trim();
    if (!blogUrl) {
      return NextResponse.json({ error: "blog_url is required" }, { status: 400 });
    }
    const supabase = await createServiceClient();
    const { data, error } = await supabase
      .from("outreach_targets")
      .insert({
        tenant_id: tenantId,
        workspace_id: workspaceId,
        blog_name: String(body.blog_name ?? "").slice(0, 200) || null,
        blog_url: blogUrl,
        contact_email: String(body.contact_email ?? "").slice(0, 300) || null,
        relevance_score: Math.max(0, Math.min(100, Number(body.relevance_score) || 0)),
        authority_score: Math.max(0, Math.min(100, Number(body.authority_score) || 0)),
        notes: String(body.notes ?? "").slice(0, 2000) || null,
      })
      .select("*")
      .single();
    if (error) throw error;
    return NextResponse.json({ target: data }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Internal error" }, { status: 500 });
  }
}
