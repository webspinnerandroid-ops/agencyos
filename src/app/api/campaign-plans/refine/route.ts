import { NextRequest, NextResponse } from "next/server";
import { getTenantId, requireRole } from "@/lib/auth";
import { refineCampaignPlan } from "@/lib/campaign-refine";

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
    const body = (await request.json()) as { planId?: string };
    if (!body.planId) {
      return NextResponse.json({ error: "planId is required" }, { status: 400 });
    }

    const result = await refineCampaignPlan(tenantId, body.planId);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
