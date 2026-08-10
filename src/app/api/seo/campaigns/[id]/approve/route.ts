import { NextRequest, NextResponse } from "next/server";
import { getTenantId, getRole, getClientId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { approveAndDeploy } from "@/lib/seo/deployCampaign";

/**
 * POST /api/seo/campaigns/[id]/approve
 *
 * Approves a campaign tier and triggers auto-deployment.
 * This creates all content pieces from the campaign's calendar as posts
 * with scheduled dates and sends a notification to the agency.
 *
 * Works for both agency users (via tenant) and client portal users
 * (via client role verification).
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createServiceClient();

    // Determine if caller is a client user
    let tenantId: string;
    try {
      const role = await getRole();
      if (role === "client") {
        // Client user: verify the campaign belongs to them
        const clientId = (await getClientId())!;
        const { data: campaign } = await supabase
          .from("seo_campaigns")
          .select("tenant_id, client_id")
          .eq("id", id)
          .single();

        if (!campaign) {
          return NextResponse.json(
            { error: "Campaign not found" },
            { status: 404 }
          );
        }

        if (campaign.client_id !== clientId) {
          return NextResponse.json(
            { error: "You can only approve your own campaigns" },
            { status: 403 }
          );
        }

        tenantId = campaign.tenant_id;
      } else {
        // Agency user: use tenant from middleware
        tenantId = await getTenantId();
      }
    } catch {
      // Fallback: use tenant ID from middleware
      tenantId = await getTenantId();
    }

    const result = await approveAndDeploy(id, tenantId);

    return NextResponse.json({
      success: true,
      campaignId: result.campaignId,
      postsCreated: result.postsCreated,
      posts: result.posts,
      errors: result.errors,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
