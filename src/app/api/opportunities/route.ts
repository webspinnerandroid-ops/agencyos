import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { getCurrentWorkspaceId } from "@/lib/workspace";
import { createServiceClient } from "@/lib/supabase/server";

/** GET /api/opportunities — list this tenant's opportunities (optionally by platform/status). */
export async function GET(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    if (!tenantId) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const workspaceId = (await getCurrentWorkspaceId().catch(() => null)) ?? null;
    const platform = request.nextUrl.searchParams.get("platform");
    const status = request.nextUrl.searchParams.get("status");

    const supabase = await createServiceClient();
    let query = supabase
      .from("content_opportunities")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("relevance_score", { ascending: false })
      .order("created_at", { ascending: false });
    if (workspaceId) query = query.eq("workspace_id", workspaceId);
    if (platform) query = query.eq("platform", platform);
    if (status) query = query.eq("status", status);

    const { data, error } = await query.limit(200);
    if (error) throw error;
    return NextResponse.json({ opportunities: data ?? [] });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Internal error" }, { status: 500 });
  }
}

/** PATCH /api/opportunities — update status (new | drafted | posted | dismissed). */
export async function PATCH(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    if (!tenantId) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const body = (await request.json().catch(() => ({}))) as { id?: string; status?: string; recommendation?: string };
    if (!body.id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }
    const patch: Record<string, unknown> = {};
    if (typeof body.status === "string") patch.status = body.status;
    if (typeof body.recommendation === "string") patch.recommendation = body.recommendation.slice(0, 3000);

    const supabase = await createServiceClient();
    const { data, error } = await supabase
      .from("content_opportunities")
      .update(patch)
      .eq("id", body.id)
      .eq("tenant_id", tenantId)
      .select("*")
      .single();
    if (error) throw error;
    return NextResponse.json({ opportunity: data });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Internal error" }, { status: 500 });
  }
}

/** DELETE /api/opportunities — remove an opportunity. */
export async function DELETE(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    if (!tenantId) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const id = request.nextUrl.searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }
    const supabase = await createServiceClient();
    const { error } = await supabase
      .from("content_opportunities")
      .delete()
      .eq("id", id)
      .eq("tenant_id", tenantId);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Internal error" }, { status: 500 });
  }
}
