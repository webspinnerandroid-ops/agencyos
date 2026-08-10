import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { approveAndDeploy } from "@/lib/seo/deployCampaign";

/**
 * PATCH /api/seo/campaigns/[id]
 * Updates a campaign (e.g., customizing tier JSON, changing status).
 *
 * Body:
 *   campaignJson (optional) - Updated campaign JSON
 *   tierName (optional)     - Updated tier name
 *   tierPrice (optional)    - Updated tier price
 *   status (optional)       - New status (proposed, approved, active, archived)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const tenantId = await getTenantId();
    const supabase = await createServiceClient();
    const { id } = await params;

    // Parse body
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    // Build update payload
    const updates: Record<string, unknown> = {};
    if (body.campaignJson !== undefined)
      updates.campaign_json = body.campaignJson;
    if (body.tierName !== undefined) updates.tier_name = body.tierName;
    if (body.tierPrice !== undefined) updates.tier_price = body.tierPrice;
    if (body.status !== undefined) updates.status = body.status;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "No fields to update" },
        { status: 400 }
      );
    }

    const { data: campaign, error } = await supabase
      .from("seo_campaigns")
      .update(updates)
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .select("*")
      .single();

    if (error) {
      return NextResponse.json(
        { error: "Failed to update campaign", details: error },
        { status: 500 }
      );
    }

    return NextResponse.json({ campaign });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/seo/campaigns/[id]
 * Deletes a campaign for this tenant.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const tenantId = await getTenantId();
    const supabase = await createServiceClient();
    const { id } = await params;

    const { error } = await supabase
      .from("seo_campaigns")
      .delete()
      .eq("id", id)
      .eq("tenant_id", tenantId);

    if (error) {
      return NextResponse.json(
        { error: "Failed to delete campaign", details: error },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/seo/campaigns/[id]/approve
 * Special action: approve and deploy this campaign.
 *
 * The client-facing approval endpoint. This is also handled by the route
 * below at .../campaigns/[id]/approve, but we include the POST method here
 * as a convenience path when called with action: "approve" in the body.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const tenantId = await getTenantId();
    const { id } = await params;

    let body: { action?: string } = {};
    try {
      body = await request.json();
    } catch {
      // No body is fine
    }

    if (body.action === "approve") {
      const result = await approveAndDeploy(id, tenantId);
      return NextResponse.json({ success: true, ...result });
    }

    return NextResponse.json(
      { error: 'Unknown action. Use action: "approve" to approve and deploy.' },
      { status: 400 }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}