import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * GET /api/seo/campaigns
 * Lists SEO campaigns for a given client or all campaigns for the tenant.
 *
 * Query params:
 *   clientId (optional) - Filter by client
 *   status (optional)   - Filter by status (e.g., "proposed", "approved", "active")
 */
export async function GET(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    const supabase = await createServiceClient();

    const { searchParams } = request.nextUrl;
    const clientId = searchParams.get("clientId");
    const status = searchParams.get("status");

    let query = supabase
      .from("seo_campaigns")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });

    if (clientId) {
      query = query.eq("client_id", clientId);
    }

    if (status) {
      query = query.eq("status", status);
    }

    const { data: campaigns, error } = await query;

    if (error) {
      return NextResponse.json(
        { error: "Failed to fetch campaigns", details: error },
        { status: 500 }
      );
    }

    return NextResponse.json({ campaigns: campaigns ?? [] });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}