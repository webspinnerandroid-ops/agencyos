import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { createSignRequest } from "@/lib/signing";

/**
 * POST /api/seo/public-proposal/[campaignId]/sign?clientId=<uuid>
 *
 * Client-facing. Lets the client, who opened the proposal share link
 * (gated by the clientId UUID — the same trust model as the public proposal
 * page), approve the tier and sign it right away on the in-house signing page
 * (/sign/[token]). Once signed, the agreement is archived to the workspace
 * storage and the campaign auto-starts.
 *
 * GET returns the current signing status so the page can show
 * Sent / Signed states.
 */

async function loadCampaign(campaignId: string, clientId: string) {
  const supabase = await createServiceClient();
  const { data: campaign, error } = await supabase
    .from("seo_campaigns")
    .select(
      "id, tenant_id, workspace_id, client_id, url, tier_name, tier_price, location, campaign_json, status, docusign_status, docusign_signed_at, signer_name, signer_email, signed_document_url"
    )
    .eq("id", campaignId)
    .single();
  if (error || !campaign) {
    return { campaign: null, error: "Proposal not found." };
  }
  if (campaign.client_id !== clientId) {
    return {
      campaign: null,
      error: "This proposal does not belong to the client for this link.",
    };
  }
  return { campaign, error: null };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  try {
    const { campaignId } = await params;
    const clientId = new URL(request.url).searchParams.get("clientId");
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!clientId || !uuidRegex.test(clientId)) {
      return NextResponse.json(
        { error: "Invalid clientId — use the link your agency sent you." },
        { status: 400 }
      );
    }

    const { campaign, error } = await loadCampaign(campaignId, clientId);
    if (error || !campaign) {
      return NextResponse.json({ error }, { status: 404 });
    }
    if (campaign.docusign_status === "completed") {
      return NextResponse.json({
        success: true,
        status: "completed",
        signUrl: null,
        signedAt: campaign.docusign_signed_at,
        signedDocumentUrl: campaign.signed_document_url,
      });
    }
    // A live sign request already exists — return its link instead of
    // creating a duplicate.
    const supabase = await createServiceClient();
    const { data: existing } = await supabase
      .from("sign_requests")
      .select("token, status, signed_at, signed_document_url")
      .eq("campaign_id", campaignId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing && existing.status !== "signed") {
      const { signUrlForToken } = await import("@/lib/signing");
      return NextResponse.json({
        success: true,
        status: existing.status,
        signUrl: signUrlForToken(existing.token),
        signedAt: existing.signed_at,
        signedDocumentUrl: existing.signed_document_url,
      });
    }

    const { data: client } = await supabase
      .from("clients")
      .select("name, email")
      .eq("id", clientId)
      .single();
    const signerName = client?.name || "Client";
    const signerEmail = client?.email || "";

    const { signUrl } = await createSignRequest({
      tenantId: campaign.tenant_id,
      campaignId: campaign.id,
      workspaceId: campaign.workspace_id ?? null,
      clientId: campaign.client_id ?? null,
      signerName,
      signerEmail,
      createdBy: null,
      sendEmail: false, // the client is already on the page
    });

    return NextResponse.json({
      success: true,
      status: "sent",
      signUrl,
      signerName,
      signerEmail,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    console.error("[public-proposal] Sign failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  try {
    const { campaignId } = await params;
    const clientId = new URL(request.url).searchParams.get("clientId");
    if (!clientId) {
      return NextResponse.json({ error: "clientId is required" }, { status: 400 });
    }
    const { campaign, error } = await loadCampaign(campaignId, clientId);
    if (error || !campaign) {
      return NextResponse.json({ error }, { status: 404 });
    }
    return NextResponse.json({
      status: campaign.docusign_status ?? "unsigned",
      signedAt: campaign.docusign_signed_at,
      signerName: campaign.signer_name,
      signedDocumentUrl: campaign.signed_document_url,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
