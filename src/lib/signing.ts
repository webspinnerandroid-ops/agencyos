// ============================================================================
// In-house e-signature flow.
//
// No third-party e-sign vendor required: the agency creates a sign request for
// a proposal, the client gets a secure token link, signs on the public
// /sign/[token] page (typed or drawn), and the signed agreement is archived in
// the workspace's Bunny storage. Completing a signature mirrors exactly what
// the old DocuSign Connect webhook did — mark the proposal signed/approved,
// store the signed document URL, and auto-start the campaign so the plan
// matches what was signed.
// ============================================================================

import crypto from "crypto";
import { createServiceClient } from "@/lib/supabase/server";
import { createCampaignFromProposal } from "@/lib/campaign-from-proposal";
import { uploadStoredFile } from "@/lib/media/storage";
// Re-exported for server callers that want the terms alongside the lib.
export { SIGNING_TERMS } from "./signing-terms";
import { SIGNING_TERMS } from "./signing-terms";

export interface SignRequestPayload {
  tenantId: string;
  campaignId: string;
  workspaceId: string | null;
  clientId: string | null;
  signerName: string;
  signerEmail: string;
  createdBy: string | null;
  /** Skip the email (e.g. the client is already on the signing page). */
  sendEmail?: boolean;
}

export interface SignRequestRow {
  id: string;
  tenant_id: string;
  campaign_id: string | null;
  workspace_id: string | null;
  client_id: string | null;
  token: string;
  status: string;
  signer_name: string | null;
  signer_email: string | null;
  sent_at: string;
  signed_at: string | null;
  signature_data: string | null;
  signature_type: string | null;
  signed_document_url: string | null;
  expires_at: string | null;
}

/** URL-safe, unguessable token for the public signing link. */
export function newSignToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

/** Public URL of a signing link for the given token. */
export function signUrlForToken(token: string): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.DOCUSIGN_APP_URL ??
    "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/sign/${token}`;
}

/**
 * Send the signing link to the client via Resend. Falls back to a log line
 * when RESEND_API_KEY isn't set — the request is still created either way and
 * the agency can copy the link from the dashboard.
 */
export async function emailSigningLink(params: {
  toEmail: string;
  signerName: string;
  tierName: string;
  url: string;
}): Promise<{ sent: boolean; detail: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log(
      `[signing] Signing link for "${params.tierName}" not emailed (no RESEND_API_KEY): ${params.url}`
    );
    return { sent: false, detail: "logged only — no RESEND_API_KEY configured" };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from:
          process.env.RESEND_FROM_EMAIL ??
          "Agency OS <contracts@updates.blissmedialab.com>",
        to: [params.toEmail],
        subject: `Your ${params.tierName} proposal is ready to sign`,
        html: `<p>Hi ${params.signerName || "there"},</p>
          <p>Your <strong>${params.tierName}</strong> proposal is ready for review and signature.</p>
          <p><a href="${params.url}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;">Review &amp; sign your proposal</a></p>
          <p style="color:#666;font-size:13px;">This link is private to you. Once signed, your campaign is set up automatically.</p>`,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const body = (await res.text().catch(() => "")).slice(0, 200);
      console.error(`[signing] Resend failed (${res.status}): ${body}`);
      return { sent: false, detail: `Resend HTTP ${res.status}` };
    }
    return { sent: true, detail: `emailed ${params.toEmail}` };
  } catch (err) {
    console.error("[signing] send failed:", (err as Error).message);
    return { sent: false, detail: (err as Error).message };
  }
}

/**
 * Create a sign request for a proposal and email the client the signing link.
 * Sets the campaign's docusign_status to 'sent' (reused column) so the
 * existing proposal-status UI reflects the state.
 */
export async function createSignRequest(
  payload: SignRequestPayload
): Promise<{ request: SignRequestRow; signUrl: string; email: { sent: boolean; detail: string } }> {
  const token = newSignToken();
  const supabase = await createServiceClient();

  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days

  const { data, error } = await supabase
    .from("sign_requests")
    .insert({
      tenant_id: payload.tenantId,
      campaign_id: payload.campaignId,
      workspace_id: payload.workspaceId ?? null,
      client_id: payload.clientId ?? null,
      token,
      status: "sent",
      signer_name: payload.signerName || null,
      signer_email: payload.signerEmail || null,
      created_by: payload.createdBy,
      expires_at: expiresAt,
    })
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? "Failed to create sign request");
  }

  const signUrl = signUrlForToken(token);

  // Record 'sent' on the campaign so the UI shows the pending state.
  await supabase
    .from("seo_campaigns")
    .update({
      docusign_status: "sent",
      signer_name: payload.signerName || null,
      signer_email: payload.signerEmail || null,
    })
    .eq("id", payload.campaignId);

  const email =
    payload.sendEmail === false || !payload.signerEmail
      ? { sent: false, detail: "email skipped" }
      : await emailSigningLink({
          toEmail: payload.signerEmail,
          signerName: payload.signerName,
          tierName: "SEO",
          url: signUrl,
        });

  return { request: data as SignRequestRow, signUrl, email };
}

/**
 * Load a sign request by token together with its campaign + client. Public
 * (token-gated) — used by the /sign/[token] page and its API routes.
 */
export async function loadSignRequest(token: string): Promise<{
  request: SignRequestRow | null;
  campaign: any | null;
  client: { name: string | null; email: string | null } | null;
} | null> {
  if (!token) return null;
  const supabase = await createServiceClient();
  const { data: request } = await supabase
    .from("sign_requests")
    .select("*")
    .eq("token", token)
    .maybeSingle();
  if (!request) return null;

  let campaign: any | null = null;
  if (request.campaign_id) {
    const { data: c } = await supabase
      .from("seo_campaigns")
      .select(
        "id, tenant_id, client_id, url, tier_name, tier_price, location, campaign_json, status, docusign_status, docusign_signed_at, signer_name, signer_email, signed_document_url"
      )
      .eq("id", request.campaign_id)
      .maybeSingle();
    campaign = c ?? null;
  }

  let client: { name: string | null; email: string | null } | null = null;
  if (request.client_id) {
    const { data: cl } = await supabase
      .from("clients")
      .select("name, email")
      .eq("id", request.client_id)
      .maybeSingle();
    client = cl ?? null;
  }

  return { request: request as SignRequestRow, campaign, client };
}



/** Build the printable signed-agreement HTML (archived to storage). */
export function buildSignedAgreementHtml(params: {
  tierName: string;
  price: number | null;
  url: string;
  location: string | null;
  executiveSummary: string;
  signerName: string;
  signerEmail: string;
  signatureDataUrl: string | null; // drawn signature image
  signatureType: "typed" | "drawn";
  signedAt: string;
  ipAddress: string | null;
}): string {
  const termsHtml = SIGNING_TERMS.map(
    (t) =>
      `<li><strong>${escapeHtml(t.heading)}.</strong> ${escapeHtml(t.body)}</li>`
  ).join("\n");

  const sigHtml =
    params.signatureType === "drawn" && params.signatureDataUrl
      ? `<img src="${params.signatureDataUrl}" alt="Signature" style="max-height:120px;border:1px solid #ccc;padding:8px;background:#fff;" />`
      : `<p style="font-size:26px;font-family:'Segoe Script','Brush Script MT',cursive;">${escapeHtml(
          params.signerName
        )}</p>`;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Signed Agreement — ${escapeHtml(
    params.tierName
  )}</title>
<style>
  body { font-family: Georgia, 'Times New Roman', serif; color: #111; line-height: 1.5; margin: 48px; }
  h1 { font-size: 22px; margin-bottom: 4px; }
  h2 { font-size: 15px; margin-top: 28px; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
  h3 { font-size: 13px; margin-bottom: 6px; }
  .muted { color: #555; font-size: 12px; }
  .price { font-size: 18px; font-weight: bold; }
  .sign-box { margin-top: 48px; border-top: 2px solid #111; padding-top: 14px; }
  .badge { display:inline-block; background:#16a34a; color:#fff; font-size:11px; padding:3px 10px; border-radius:999px; }
  ol.terms { font-size: 12px; line-height: 1.6; }
</style></head>
<body>
  <p><span class="badge">SIGNED AGREEMENT</span></p>
  <h1>SEO Proposal — ${escapeHtml(params.tierName)}</h1>
  <p class="muted">For: ${escapeHtml(params.url)}${params.location ? ` · ${escapeHtml(params.location)}` : ""}</p>
  <p class="price">${params.price == null ? "Custom Consult" : `$${params.price.toLocaleString()}/month`}</p>

  <h2>Executive Summary</h2>
  <p>${escapeHtml(params.executiveSummary)}</p>

  <h2>Terms of Service</h2>
  <ol class="terms">
    ${termsHtml}
  </ol>

  <h2>Signature</h2>
  <div class="sign-box">
    ${sigHtml}
    <p><strong>${escapeHtml(params.signerName)}</strong> (${escapeHtml(params.signerEmail)})</p>
    <p class="muted">Signed ${new Date(params.signedAt).toLocaleString("en-US", {
      dateStyle: "long",
      timeStyle: "short",
    })} · IP ${escapeHtml(params.ipAddress ?? "unknown")} · Signature type: ${
    params.signatureType
  }</p>
  </div>
  <p class="muted" style="margin-top:32px;">By signing, ${escapeHtml(
    params.signerName
  )} authorizes the agency to begin the campaign described above. This agreement was signed electronically and is stored in the client's workspace.</p>
</body></html>`;
}

function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Finalize a signature: validate the token, mark the sign request signed,
 * archive the signed agreement to Bunny storage, mirror the result onto the
 * proposal (approved + signed metadata), and auto-start the campaign —
 * exactly the path the DocuSign Connect webhook used, so behavior matches.
 *
 * Idempotent: a request already 'signed' returns the stored state untouched.
 */
export async function finalizeSignature(params: {
  token: string;
  signerName: string;
  signatureType: "typed" | "drawn";
  signatureDataUrl: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}): Promise<{
  status: string;
  signedDocumentUrl: string | null;
  alreadySigned: boolean;
}> {
  const loaded = await loadSignRequest(params.token);
  if (!loaded || !loaded.request) {
    throw new Error("This signing link is invalid or has expired.");
  }
  const { request, campaign, client } = loaded;

  if (request.status === "signed") {
    return {
      status: "signed",
      signedDocumentUrl: request.signed_document_url,
      alreadySigned: true,
    };
  }
  if (request.status !== "sent") {
    throw new Error(
      request.status === "expired"
        ? "This signing link has expired. Ask your agency to send a new one."
        : "This signing link is no longer valid."
    );
  }
  if (request.expires_at && new Date(request.expires_at).getTime() < Date.now()) {
    await (await sb()).from("sign_requests").update({ status: "expired" }).eq("id", request.id);
    throw new Error("This signing link has expired. Ask your agency to send a new one.");
  }

  const signerName = params.signerName.trim() || request.signer_name || client?.name || "Client";
  const signerEmail = request.signer_email || client?.email || "";
  const signedAt = new Date().toISOString();

  // 1. Build + archive the signed agreement.
  const json = (campaign?.campaign_json ?? {}) as {
    tierName?: string;
    tierPrice?: number;
    executiveSummary?: string;
  };
  const html = buildSignedAgreementHtml({
    tierName: json.tierName ?? campaign?.tier_name ?? "SEO Plan",
    price: json.tierPrice ?? campaign?.tier_price ?? null,
    url: campaign?.url ?? "",
    location: campaign?.location ?? null,
    executiveSummary: json.executiveSummary ?? "",
    signerName,
    signerEmail,
    signatureDataUrl: params.signatureDataUrl,
    signatureType: params.signatureType,
    signedAt,
    ipAddress: params.ipAddress,
  });

  let signedDocumentUrl: string | null = null;
  try {
    signedDocumentUrl = await uploadStoredFile(
      request.tenant_id,
      `contracts/${campaign?.id ?? request.campaign_id}-signed.html`,
      Buffer.from(html, "utf8"),
      "text/html"
    );
  } catch (err) {
    console.error("[signing] Failed to archive signed agreement:", (err as Error).message);
  }

  // 2. Mark the sign request signed.
  await (await sb())
    .from("sign_requests")
    .update({
      status: "signed",
      signed_at: signedAt,
      signer_name: signerName,
      signature_data: params.signatureType === "drawn" ? params.signatureDataUrl : null,
      signature_type: params.signatureType,
      ip_address: params.ipAddress,
      user_agent: params.userAgent,
      signed_document_url: signedDocumentUrl,
    })
    .eq("id", request.id);

  // 3. Mirror onto the proposal (guarded: only the first completion flips it).
  if (campaign && campaign.docusign_status !== "completed") {
    await (await sb())
      .from("seo_campaigns")
      .update({
        docusign_status: "completed",
        docusign_signed_at: signedAt,
        status: "approved",
        signer_name: signerName,
        signer_email: signerEmail || null,
        signed_document_url: signedDocumentUrl,
      })
      .eq("id", campaign.id)
      .neq("docusign_status", "completed");
  }

  // 4. Auto-start the campaign (best-effort; the signature is recorded regardless).
  if (campaign) {
    try {
      await createCampaignFromProposal(
        request.tenant_id,
        campaign.id,
        request.workspace_id ?? campaign.workspace_id ?? null
      );
      console.log(`[signing] Campaign ${campaign.id} auto-started after signature`);
    } catch (err) {
      console.error(
        `[signing] Signed but auto-start failed for ${campaign.id}:`,
        (err as Error).message
      );
    }
  }

  return { status: "signed", signedDocumentUrl, alreadySigned: false };
}

let clientPromise: Promise<any> | null = null;
/** Lazy, cached service client so the top-level module stays side-effect free. */
function sb() {
  clientPromise ??= createServiceClient();
  return clientPromise;
}
