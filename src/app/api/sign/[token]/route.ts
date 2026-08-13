import { NextRequest, NextResponse } from "next/server";
import { loadSignRequest, finalizeSignature } from "@/lib/signing";

/**
 * GET /api/sign/[token]
 * Public, token-gated: returns the proposal data needed to render the signing
 * page (tier, price, summary, terms, signer identity) plus the request status.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const loaded = await loadSignRequest(token);
    if (!loaded || !loaded.request || !loaded.campaign) {
      return NextResponse.json(
        { error: "This signing link is invalid or has expired." },
        { status: 404 }
      );
    }
    const { request, campaign, client } = loaded;

    if (request.status === "expired") {
      return NextResponse.json(
        { error: "This signing link has expired. Ask your agency to send a new one." },
        { status: 410 }
      );
    }

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
      [key: string]: unknown;
    };

    return NextResponse.json({
      status: request.status,
      signerName: request.signer_name ?? client?.name ?? "",
      signerEmail: request.signer_email ?? client?.email ?? "",
      signedAt: request.signed_at,
      signedDocumentUrl: request.signed_document_url,
      proposal: {
        title: `SEO Proposal — ${json.tierName ?? campaign.tier_name ?? "SEO"}`,
        tierName: json.tierName ?? campaign.tier_name ?? "SEO Plan",
        price: json.tierPrice ?? campaign.tier_price ?? null,
        url: campaign.url ?? "",
        location: campaign.location ?? null,
        executiveSummary: json.executiveSummary ?? "",
        targetKeywords: Array.isArray(json.targetKeywords) ? json.targetKeywords : [],
        deliverables: Array.isArray(json.deliverables) ? json.deliverables : [],
        contentCalendar: Array.isArray(json.contentCalendar) ? json.contentCalendar : [],
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/sign/[token]
 * Public, token-gated: submits the signature. Validates the request state,
 * archives the signed agreement, mirrors the result onto the proposal, and
 * auto-starts the campaign (idempotent — a second submit returns the stored
 * result).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      signerName?: string;
      signatureType?: "typed" | "drawn";
      signatureDataUrl?: string | null;
    };

    const signerName = String(body.signerName ?? "").trim();
    const signatureType: "typed" | "drawn" =
      body.signatureType === "drawn" ? "drawn" : "typed";
    let signatureDataUrl: string | null =
      typeof body.signatureDataUrl === "string" && body.signatureDataUrl
        ? body.signatureDataUrl
        : null;

    // Validate: typed signatures just need a name; drawn need an image data URL.
    if (!signerName) {
      return NextResponse.json(
        { error: "Please enter your full legal name to sign." },
        { status: 400 }
      );
    }
    if (signatureType === "drawn" && !signatureDataUrl) {
      return NextResponse.json(
        { error: "Please draw your signature before submitting." },
        { status: 400 }
      );
    }
    if (signatureType === "typed") signatureDataUrl = null;

    // Cap the stored data URL (drawn signatures) at a sane size.
    if (signatureDataUrl && signatureDataUrl.length > 500_000) {
      return NextResponse.json(
        { error: "Signature image is too large — try drawing it again." },
        { status: 400 }
      );
    }

    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      request.headers.get("x-real-ip") ??
      null;
    const ua = request.headers.get("user-agent");

    const result = await finalizeSignature({
      token,
      signerName,
      signatureType,
      signatureDataUrl,
      ipAddress: ip,
      userAgent: ua,
    });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    console.error("[sign] Submit failed:", message);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
