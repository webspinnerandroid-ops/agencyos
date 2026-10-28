import { NextRequest, NextResponse } from "next/server";
import { getTenantId, requireRole } from "@/lib/auth";
import { refineCampaignPlan } from "@/lib/campaign-refine";
import { parseJsonBody } from "@/lib/api-validate";
import { campaignRefineSchema } from "@/lib/validations";

/**
 * POST /api/campaign-plans/refine
 *
 * "Refine with Malory" — one structured call that polishes an existing
 * campaign plan (dates, titles, spacing) while staying grounded in its
 * current scope.
 *
 * Body: { planId: string }
 */
export async function POST(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    await requireRole("agency_editor");
    const body = await parseJsonBody(request, campaignRefineSchema);
    if (!body.ok) return body.response;

    const result = await refineCampaignPlan(tenantId, body.data.planId);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
