import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { computeContentScores } from "@/lib/seo/audit-report";

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

    // Attach the client's SEO/AEO/GEO content scores, computed from the
    // stored homepage crawl with the same engines as the public report — so
    // the dashboard shows the client's scores without a second crawl.
    const withScores = (campaigns ?? []).map((c: Record<string, unknown>) => {
      const scores = computeContentScores(
        (c.audit_json ?? undefined) as unknown as Parameters<
          typeof computeContentScores
        >[0],
        (c.url as string) ?? undefined
      );
      return { ...c, contentScores: scores };
    });

    return NextResponse.json({ campaigns: withScores });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}