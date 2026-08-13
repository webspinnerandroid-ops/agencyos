import { NextRequest, NextResponse } from "next/server";
import { getTenantId, getUserId, requireRole } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import {
  assertTenantOwner,
  tenantScopedClient,
} from "@/lib/supabase/tenant-scope";
import { createSignRequest, signUrlForToken } from "@/lib/signing";

/**
 * POST /api/seo/campaigns/[id]/sign-request
 * Body: { signerName?: string, signerEmail?: string }
 *
 * Creates an in-house sign request for the proposal and emails the client a
 * secure signing link (/sign/[token]). The client signs on that page; the
 * signed agreement is archived to the workspace storage and the campaign
 * auto-starts. Returns the signing URL so the agency can also copy it.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const tenantId = await getTenantId();
    if (!tenantId) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    await requireRole("agency_editor");

    const supabase = await createServiceClient();
    const scoped = tenantScopedClient(supabase, tenantId);

    const { data: campaign } = await scoped
      .from("seo_campaigns")
      .select(
        "id, tenant_id, workspace_id, client_id, url, tier_name, status, docusign_status, signer_name, signer_email"
      )
      .eq("id", id)
      .single();
    const owned = assertTenantOwner(campaign, tenantId, "Campaign");

    if (owned.docusign_status === "completed") {
      return NextResponse.json(
        { error: "This proposal has already been signed." },
        { status: 409 }
      );
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

    const userId = await getUserId().catch(() => null);

    const { request: signRequest, signUrl, email } = await createSignRequest({
      tenantId,
      campaignId: owned.id,
      workspaceId: owned.workspace_id ?? null,
      clientId: owned.client_id ?? null,
      signerName,
      signerEmail,
      createdBy: userId,
    });

    return NextResponse.json({
      success: true,
      status: signRequest.status,
      signUrl,
      token: signRequest.token,
      email: email.detail,
      signerName,
      signerEmail,
      copyableUrl: signUrlForToken(signRequest.token),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    console.error("[sign-request] Send failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * GET /api/seo/campaigns/[id]/sign-request
 * Returns the latest sign request for the campaign (so the dashboard can show
 * the sent link / status after a refresh).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const tenantId = await getTenantId();
    if (!tenantId) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const supabase = await createServiceClient();
    const scoped = tenantScopedClient(supabase, tenantId);
    const { data: requests } = await scoped
      .from("sign_requests")
      .select("*")
      .eq("campaign_id", id)
      .order("created_at", { ascending: false })
      .limit(5);
    return NextResponse.json({ requests: requests ?? [] });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
