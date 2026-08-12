import { NextRequest, NextResponse } from "next/server";
import { getTenantId, requireRole } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import {
  assertTenantOwner,
  tenantScopedClient,
} from "@/lib/supabase/tenant-scope";
import {
  isDocuSignConfigured,
  createProposalEnvelope,
  getEnvelopeStatus,
  buildProposalHtml,
  type EnvelopeStatus,
} from "@/lib/docusign";

/**
 * POST /api/seo/campaigns/[id]/docusign
 * Body: { signerName?: string, signerEmail?: string }
 * Creates a DocuSign envelope for the proposal and returns the embedded
 * signing URL (one-time). The agency shares the URL with the client.
 *
 * GET  /api/seo/campaigns/[id]/docusign
 * Returns the current signing status (and syncs from DocuSign when an
 * envelope exists but has not been reported by the Connect webhook yet).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const tenantId = await getTenantId();
    await requireRole("agency_editor");

    if (!isDocuSignConfigured()) {
      return NextResponse.json(
        {
          error:
            "DocuSign is not configured for this deployment. Add the DocuSign environment variables (see docs) and restart, or approve the proposal directly.",
        },
        { status: 501 }
      );
    }

    const supabase = await createServiceClient();
    const scoped = tenantScopedClient(supabase, tenantId);

    const { data: campaign } = await scoped
      .from("seo_campaigns")
      .select(
        "id, tenant_id, client_id, url, tier_name, tier_price, location, campaign_json, status, docusign_envelope_id, docusign_status, signer_name, signer_email, created_by"
      )
      .eq("id", id)
      .single();
    const owned = assertTenantOwner(campaign, tenantId, "Campaign");

    // Re-sending after a completed signature is not allowed.
    if (owned.docusign_status === "completed") {
      return NextResponse.json(
        { error: "This proposal has already been signed." },
        { status: 409 }
      );
    }
    // If an envelope already exists, return its signing status (idempotent).
    if (owned.docusign_envelope_id && owned.docusign_status !== "declined" && owned.docusign_status !== "voided") {
      const status = await getEnvelopeStatus(owned.docusign_envelope_id);
      return NextResponse.json({
        envelopeId: owned.docusign_envelope_id,
        status: status.status,
        signingUrl: null,
      });
    }

    const body = (await request.json().catch(() => ({}))) as {
      signerName?: string;
      signerEmail?: string;
    };

    // Resolve signer identity: explicit body values win, then stored values,
    // then the client record's name/email.
    let signerName = body.signerName?.trim() || owned.signer_name || "";
    let signerEmail = body.signerEmail?.trim() || owned.signer_email || "";
    if ((!signerName || !signerEmail) && owned.client_id) {
      const { data: client } = await scoped
        .from("clients")
        .select("name, email")
        .eq("id", owned.client_id)
        .single();
      signerName = signerName || client?.name || "";
      signerEmail = signerEmail || client?.email || "";
    }
    if (!signerName || !signerEmail) {
      return NextResponse.json(
        {
          error:
            "No signer identity on file. Add the client's email in the New Audit form (or pass signerName/signerEmail), then send again.",
        },
        { status: 400 }
      );
    }

    const json = (owned.campaign_json ?? {}) as {
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
      process.env.NEXT_PUBLIC_APP_URL ??
      "http://localhost:3000";

    const html = buildProposalHtml({
      title: `SEO Proposal — ${json.tierName ?? owned.tier_name ?? "SEO"}`,
      tierName: json.tierName ?? owned.tier_name ?? "SEO Plan",
      price: json.tierPrice ?? owned.tier_price ?? null,
      url: owned.url ?? "",
      location: owned.location ?? null,
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
      signerEmail,
      preparedBy: "Agency OS",
    });

    const created = await createProposalEnvelope({
      signerName,
      signerEmail,
      title: `SEO Proposal — ${json.tierName ?? owned.tier_name ?? "SEO"}`,
      html,
      returnUrl: `${origin}/seo/proposal?clientId=${owned.client_id ?? ""}&signed=1`,
    });

    // Record the envelope + signer on the proposal.
    await scoped
      .from("seo_campaigns")
      .update({
        docusign_envelope_id: created.envelopeId,
        docusign_status: created.status,
        signer_name: signerName,
        signer_email: signerEmail,
      })
      .eq("id", id);

    return NextResponse.json({
      success: true,
      envelopeId: created.envelopeId,
      status: created.status,
      signingUrl: created.signingUrl,
      signerName,
      signerEmail,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    console.error("[docusign] Send failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const tenantId = await getTenantId();
    const supabase = await createServiceClient();
    const scoped = tenantScopedClient(supabase, tenantId);

    const { data: campaign } = await scoped
      .from("seo_campaigns")
      .select("tenant_id, docusign_envelope_id, docusign_status, docusign_signed_at, signer_name, signer_email")
      .eq("id", id)
      .single();
    const owned = assertTenantOwner(campaign, tenantId, "Campaign");

    if (!owned.docusign_envelope_id) {
      return NextResponse.json({ status: "unsigned" });
    }

    // Sync live status from DocuSign when the webhook hasn't reported yet.
    let status: EnvelopeStatus = owned.docusign_status ?? "sent";
    if (status !== "completed" && status !== "declined") {
      try {
        const live = await getEnvelopeStatus(owned.docusign_envelope_id);
        status = live.status;
        if (status !== owned.docusign_status) {
          await scoped
            .from("seo_campaigns")
            .update({ docusign_status: status })
            .eq("id", id);
        }
      } catch {
        // DocuSign unreachable — fall back to stored status.
      }
    }

    return NextResponse.json({
      status,
      signedAt: owned.docusign_signed_at,
      signerName: owned.signer_name,
      signerEmail: owned.signer_email,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    console.error("[docusign] Send failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

