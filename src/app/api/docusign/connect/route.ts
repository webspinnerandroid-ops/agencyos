import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { verifyConnectSignature } from "@/lib/docusign";
import { createCampaignFromProposal } from "@/lib/campaign-from-proposal";

/**
 * POST /api/docusign/connect
 *
 * DocuSign Connect webhook. Verifies the HMAC signature (X-DocuSign-Signature-*),
 * then:
 *  - records the live envelope status on the proposal, and
 *  - when the envelope is COMPLETED, marks the proposal approved/signed and
 *    auto-starts the campaign (materializes the sold tier onto the Content
 *    Calendar via createCampaignFromProposal — the same path as the agency's
 *    "Start Campaign" button, so the plan matches exactly what was signed).
 *
 * Idempotent: only acts once per envelope because the row's status is flipped
 * before the plan is created.
 */

interface ConnectPayload {
  event?: string;
  data?: {
    envelopeId?: string;
    status?: string;
    completedDateTime?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export async function POST(request: NextRequest) {
  const raw = await request.text();
  const sigHeaders = [
    request.headers.get("x-docusign-signature-1"),
    request.headers.get("x-docusign-signature-2"),
    request.headers.get("x-docusign-signature-3"),
    request.headers.get("x-docusign-signature-4"),
  ].filter((s): s is string => Boolean(s));

  if (!verifyConnectSignature(raw, sigHeaders)) {
    console.warn("[docusign-connect] Rejected webhook: HMAC verification failed");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: ConnectPayload;
  try {
    payload = JSON.parse(raw) as ConnectPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const envelopeId = payload.data?.envelopeId;
  if (!envelopeId) {
    // Connect also delivers "ping" / account-level events without an envelope.
    return NextResponse.json({ ok: true });
  }
  const envelopeStatus = payload.data?.status ?? payload.event;

  const supabase = await createServiceClient();

  const { data: campaign, error: campaignError } = await supabase
    .from("seo_campaigns")
    .select("id, tenant_id, workspace_id, status, docusign_status")
    .eq("docusign_envelope_id", envelopeId)
    .maybeSingle();

  if (!campaign) {
    // Envelope exists but isn't linked to a proposal here — acknowledge so
    // DocuSign stops retrying, but log it.
    console.warn(`[docusign-connect] Envelope ${envelopeId} not linked to a proposal`);
    return NextResponse.json({ ok: true });
  }

  if (envelopeStatus === "completed") {
    // Already handled by a previous delivery → acknowledge (idempotent).
    if (campaign.docusign_status === "completed") {
      return NextResponse.json({ ok: true });
    }

    const { error: updateError } = await supabase
      .from("seo_campaigns")
      .update({
        docusign_status: "completed",
        docusign_signed_at: payload.data?.completedDateTime
          ? new Date(payload.data.completedDateTime)
          : new Date(),
        status: "approved",
      })
      .eq("id", campaign.id)
      .neq("docusign_status", "completed"); // guard: only the first completion flips it

    if (updateError) {
      console.error("[docusign-connect] Failed to mark proposal signed:", updateError.message);
      return NextResponse.json({ error: "DB update failed" }, { status: 500 });
    }

    // Auto-start: materialize the signed tier onto the Content Calendar.
    try {
      await createCampaignFromProposal(
        campaign.tenant_id,
        campaign.id,
        campaign.workspace_id ?? null
      );
      console.log(
        `[docusign-connect] Campaign ${campaign.id} auto-started after signature (${envelopeId})`
      );
    } catch (planError: any) {
      // The signature is recorded regardless; the agency can start the
      // campaign manually if the plan step fails.
      console.error(
        `[docusign-connect] Signed but auto-start failed for ${campaign.id}:`,
        planError?.message ?? planError
      );
    }
  } else {
    // sent / delivered / declined / voided — just mirror the live status.
    await supabase
      .from("seo_campaigns")
      .update({ docusign_status: envelopeStatus })
      .eq("id", campaign.id);
  }

  return NextResponse.json({ ok: true });
}
