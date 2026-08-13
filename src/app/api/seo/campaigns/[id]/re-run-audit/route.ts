import { NextResponse } from "next/server";
import { getTenantId, requireRole } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { assertTenantOwner, tenantScopedClient } from "@/lib/supabase/tenant-scope";
import { rescoreCompetitorEntries } from "@/lib/seo/competitor-backfill";

/**
 * POST /api/seo/campaigns/[id]/re-run-audit
 *
 * Refreshes a past campaign's competitor SEO/AEO/GEO benchmark scores (re-fetch
 * + re-score each stored competitor) WITHOUT re-crawling the client's site or
 * regenerating the tier proposals. The client's own audit_json is untouched.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const tenantId = await getTenantId();
    await requireRole("agency_editor");

    const supabase = await createServiceClient();
    const scoped = tenantScopedClient(supabase, tenantId);

    const { data: campaign } = await scoped
      .from("seo_campaigns")
      .select("id, tenant_id, competitors_json")
      .eq("id", id)
      .single();
    const owned = assertTenantOwner(campaign, tenantId, "Campaign");

    const competitors = Array.isArray(owned.competitors_json)
      ? owned.competitors_json
      : [];

    const { entries, scored, unreachable } = await rescoreCompetitorEntries(
      competitors
    );

    const { error } = await scoped
      .from("seo_campaigns")
      .update({ competitors_json: entries })
      .eq("id", owned.id);
    if (error) throw error;

    return NextResponse.json({ ok: true, competitors: entries, scored, unreachable });
  } catch (err: any) {
    const status = /not found|No rows|Campaign/i.test(err?.message ?? "") ? 404 : 500;
    return NextResponse.json(
      { error: err?.message ?? "Failed to re-run audit" },
      { status }
    );
  }
}
