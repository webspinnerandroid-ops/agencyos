import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import {
  isDocuSignConfigured,
  createProposalEnvelope,
  getEnvelopeStatus,
  buildProposalHtml,
} from "@/lib/docusign";

/**
 * POST /api/seo/public-proposal/[campaignId]/sign?clientId=<uuid>
 *
 * Client-facing. Lets the client, who opened the proposal share link
 * (gated by the clientId UUID — the same trust model as the public proposal
 * page), approve the tier and sign it with DocuSign right away. Once DocuSign
 * reports completion, the Connect webhook marks it signed and auto-starts the
 * campaign.
 *
 * GET returns the current signing status so the page can show
 * Sent / Signed states.
 */

async function loadCampaign(campaignId: string, clientId: string) {
  const supabase = await createServiceClient();
  const { data: campaign, error } = await supabase
    .from("seo_campaigns")
    .select(
      "id, tenant_id, client_id, url, tier_name, tier_price, location, campaign_json, status, docusign_envelope_id, docusign_status, docusign_signed_at, signer_name, signer_email"
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

    if (!isDocuSignConfigured()) {
      return NextResponse.json(
        {
          error:
            "E-signature is not enabled for this agency yet. Contact your agency to approve the proposal directly.",
        },
        { status: 501 }
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
        signingUrl: null,
        signedAt: campaign.docusign_signed_at,
      });
    }
    if (campaign.docusign_envelope_id && campaign.docusign_status !== "declined" && campaign.docusign_status !== "voided") {
      const live = await getEnvelopeStatus(campaign.docusign_envelope_id);
      return NextResponse.json({
        success: true,
        status: live.status,
        signingUrl: null,
      });
    }

    const body = (await request.json().catch(() => ({}))) as {
      signerName?: string;
      signerEmail?: string;
    };
    const supabase = await createServiceClient();
    const { data: client } = await supabase
      .from("clients")
      .select("name, email")
      .eq("id", clientId)
      .single();
    const signerName = body.signerName?.trim() || client?.name || "Client";
    const signerEmail = body.signerEmail?.trim() || client?.email || "";

    const json = (campaign.campaign_json ?? {}) as {
      tierName?: string;
      tierPrice?: number;
      executiveSummary?: string;
      targetKeywords?: {
        keyword: string;
        searchVolume: number;
        difficulty: string;
        intent: string;
      }[];
      deliverables?: string[];
      contentCalendar?: {
        month: number;
        focusArea: string;
        contentPieces?: { type: string; title: string }[];
      }[];
    };

    const origin =
      process.env.DOCUSIGN_APP_URL ??
      request.nextUrl.origin ??
      "http://localhost:3000";

    const html = buildProposalHtml({
      title: `SEO Proposal — ${json.tierName ?? campaign.tier_name ?? "SEO"}`,
      tierName: json.tierName ?? campaign.tier_name ?? "SEO Plan",
      price: json.tierPrice ?? campaign.tier_price ?? null,
      url: campaign.url ?? "",
      location: campaign.location ?? null,
      executiveSummary: json.executiveSummary ?? "",
      keywords: Array.isArray(json.targetKeywords)
        ? json.targetKeywords.map((k) => ({
            keyword: k.keyword ?? "",
            searchVolume: k.searchVolume ?? 0,
            difficulty: k.difficulty ?? "medium",
            intent: k.intent ?? "informational",
          }))
        : [],
      deliverables: Array.isArray(json.deliverables) ? json.deliverables : [],
      calendar: Array.isArray(json.contentCalendar)
        ? json.contentCalendar.map((m) => ({
            month: m.month,
            focusArea: m.focusArea ?? "",
            pieces: Array.isArray(m.contentPieces) ? m.contentPieces : [],
          }))
        : [],
      signerName,
      signerEmail: signerEmail || "",
      preparedBy: "Agency OS",
    });

    const created = await createProposalEnvelope({
      signerName,
      signerEmail: signerEmail || "client@example.invalid",
      title: `SEO Proposal — ${json.tierName ?? campaign.tier_name ?? "SEO"}`,
      html,
      returnUrl: `${origin}/seo/proposal?clientId=${clientId}&signed=1`,
    });

    await supabase
      .from("seo_campaigns")
      .update({
        docusign_envelope_id: created.envelopeId,
        docusign_status: created.status,
        signer_name: signerName,
        signer_email: signerEmail || null,
      })
      .eq("id", campaignId);

    return NextResponse.json({
      success: true,
      status: created.status,
      signingUrl: created.signingUrl,
      envelopeId: created.envelopeId,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    console.error("[docusign] Public sign failed:", message);
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
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
