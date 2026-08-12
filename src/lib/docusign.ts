// ============================================================================
// DocuSign eSignature integration (REST API v2.1, JWT Grant).
//
// Lets a proposal (seo_campaigns row) be sent for signature. The client signs
// on DocuSign (embedded signing URL), and the Connect webhook
// (/api/docusign/connect) verifies the HMAC, marks the proposal signed and
// auto-starts the campaign.
//
// Configuration (all optional — the feature degrades to "not configured"):
//   DOCUSIGN_INTEGRATION_KEY      - Integration Key (client ID) from the app
//   DOCUSIGN_USER_ID              - impersonated user GUID (API user)
//   DOCUSIGN_ACCOUNT_ID           - account GUID (optional; uses default)
//   DOCUSIGN_PRIVATE_KEY          - RSA private key (PEM, or \n-escaped)
//   DOCUSIGN_PRIVATE_KEY_BASE64   - alternative: base64 of the PEM key
//   DOCUSIGN_AUTH_SERVER          - "account-d.docusign.com" (sandbox,
//                                   default) or "account.docusign.com" (prod)
//   DOCUSIGN_CONNECT_SECRET       - Connect HMAC secret for webhook verify
//   DOCUSIGN_APP_URL              - base URL for the returnUrl after signing
// ============================================================================

import crypto from "crypto";

const AUTH_SERVER =
  process.env.DOCUSIGN_AUTH_SERVER ?? "account-d.docusign.com";

export function isDocuSignConfigured(): boolean {
  return Boolean(
    process.env.DOCUSIGN_INTEGRATION_KEY &&
      process.env.DOCUSIGN_USER_ID &&
      (process.env.DOCUSIGN_PRIVATE_KEY || process.env.DOCUSIGN_PRIVATE_KEY_BASE64)
  );
}

function getPrivateKey(): string {
  const raw =
    process.env.DOCUSIGN_PRIVATE_KEY ??
    process.env.DOCUSIGN_PRIVATE_KEY_BASE64 ??
    "";
  if (raw.includes("BEGIN")) return raw;
  try {
    const decoded = Buffer.from(raw, "base64").toString("utf8");
    if (decoded.includes("BEGIN")) return decoded;
  } catch {
    /* fall through */
  }
  throw new Error(
    "DocuSign private key is not a PEM block (set DOCUSIGN_PRIVATE_KEY or DOCUSIGN_PRIVATE_KEY_BASE64)."
  );
}

function base64UrlEncode(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function assertConfigured(): void {
  if (!isDocuSignConfigured()) {
    throw new Error(
      "DocuSign is not configured. Add DOCUSIGN_INTEGRATION_KEY, DOCUSIGN_USER_ID and a private key to your environment."
    );
  }
}

/** Build a JWT assertion and exchange it for a DocuSign access token. */
export async function getAccessToken(): Promise<string> {
  assertConfigured();
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64UrlEncode(
    JSON.stringify({
      iss: process.env.DOCUSIGN_INTEGRATION_KEY,
      sub: process.env.DOCUSIGN_USER_ID,
      aud: AUTH_SERVER,
      iat: now,
      exp: now + 3600,
      scope: "signature",
    })
  );
  const unsigned = `${header}.${claims}`;
  const signature = crypto
    .createSign("RSA-SHA256")
    .update(unsigned)
    .sign(getPrivateKey(), "base64");
  const assertion = `${unsigned}.${base64UrlEncode(signature)}`;

  const res = await fetch(`https://${AUTH_SERVER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`DocuSign token exchange failed (${res.status}): ${text}`);
  }
  let data: { access_token?: string };
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`DocuSign token exchange returned invalid JSON: ${text}`);
  }
  if (!data.access_token) {
    throw new Error("DocuSign token exchange returned no access_token");
  }
  return data.access_token;
}

interface DocusignAccount {
  account_id?: string;
  base_uri?: string;
  is_default?: boolean;
}

/** Discover the account's REST base URI (v2.1). */
export async function getBaseUri(token: string): Promise<string> {
  const res = await fetch(`https://${AUTH_SERVER}/oauth/userinfo`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`DocuSign userinfo failed (${res.status}): ${text}`);
  }
  const data = JSON.parse(text) as { accounts?: DocusignAccount[] };
  const accounts = data.accounts ?? [];
  const accountId = process.env.DOCUSIGN_ACCOUNT_ID;
  const match = accountId
    ? accounts.find((a) => a.account_id === accountId)
    : accounts.find((a) => a.is_default) ?? accounts[0];
  if (!match?.base_uri) {
    throw new Error("No DocuSign account found for this user");
  }
  return `${match.base_uri.replace(/\/$/, "")}/restapi/v2.1/accounts/${match.account_id}`;
}

export interface ProposalEnvelopeInput {
  /** Signer (usually the client). */
  signerName: string;
  signerEmail: string;
  /** Human-readable subject + document title. */
  title: string;
  /** HTML body of the proposal document. */
  html: string;
  /** Where DocuSign sends the signer after completing. */
  returnUrl: string;
}

export interface CreatedEnvelope {
  envelopeId: string;
  signingUrl: string;
  status: string;
}

/**
 * Create an envelope with an embedded signer and return the one-time signing
 * URL. Embedded signing (clientUserId) means DocuSign does not email the
 * signer — the app delivers the URL (agency shares it or the client signs
 * from the public proposal page).
 */
export async function createProposalEnvelope(
  input: ProposalEnvelopeInput
): Promise<CreatedEnvelope> {
  const token = await getAccessToken();
  const base = await getBaseUri(token);

  const documentBase64 = Buffer.from(input.html, "utf8").toString("base64");

  // Place the signature tab on the marker rendered in the HTML; if anchor
  // matching fails, fall back to fixed coordinates on page 1.
  // (Record<string, string> keeps the literal type from blocking the
  // coordinate-based fallback tab below.)
  const anchorTab: Record<string, string> = {
    documentId: "1",
    pageNumber: "1",
    anchorString: "SIGN_HERE_MARKER",
    anchorUnits: "pixels",
    anchorYOffset: "-12",
    anchorXOffset: "0",
  };

  const envelopeBody = {
    emailSubject: input.title,
    documents: [
      {
        documentId: "1",
        name: "Proposal",
        fileExtension: "html",
        documentBase64,
      },
    ],
    recipients: {
      signers: [
        {
          email: input.signerEmail,
          name: input.signerName,
          recipientId: "1",
          routingOrder: "1",
          clientUserId: "1",
          tabs: { signHereTabs: [anchorTab] },
        },
      ],
    },
    status: "sent",
  };

  let envelopeRes = await fetch(`${base}/envelopes`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(envelopeBody),
  });
  let envelopeText = await envelopeRes.text();

  // Anchor not found → retry once with absolute coordinates.
  if (!envelopeRes.ok && /anchor|tabs were not applied/i.test(envelopeText)) {
    envelopeBody.recipients.signers[0].tabs = {
      signHereTabs: [
        { documentId: "1", pageNumber: "1", xPosition: "200", yPosition: "700" },
      ],
    };
    envelopeRes = await fetch(`${base}/envelopes`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(envelopeBody),
    });
    envelopeText = await envelopeRes.text();
  }

  if (!envelopeRes.ok) {
    throw new Error(`DocuSign envelope creation failed (${envelopeRes.status}): ${envelopeText}`);
  }
  const created = JSON.parse(envelopeText) as { envelopeId: string; status: string };
  if (!created.envelopeId) {
    throw new Error("DocuSign returned an envelope without an id");
  }

  // Embedded recipient view (one-time signing URL).
  const viewRes = await fetch(`${base}/envelopes/${created.envelopeId}/views/recipient`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      returnUrl: input.returnUrl,
      authenticationMethod: "none",
      clientUserId: "1",
      email: input.signerEmail,
      userName: input.signerName,
    }),
  });
  const viewText = await viewRes.text();
  if (!viewRes.ok) {
    throw new Error(`DocuSign recipient view failed (${viewRes.status}): ${viewText}`);
  }
  const view = JSON.parse(viewText) as { url?: string };
  if (!view.url) {
    throw new Error("DocuSign returned a recipient view without a URL");
  }

  return {
    envelopeId: created.envelopeId,
    signingUrl: view.url,
    status: created.status,
  };
}

export type EnvelopeStatus =
  | "sent"
  | "delivered"
  | "completed"
  | "declined"
  | "voided"
  | "expired"
  | "created";

/** Fetch an envelope's current status. */
export async function getEnvelopeStatus(
  envelopeId: string
): Promise<{ status: EnvelopeStatus; signedAt?: string }> {
  const token = await getAccessToken();
  const base = await getBaseUri(token);
  const res = await fetch(`${base}/envelopes/${envelopeId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`DocuSign envelope status failed (${res.status}): ${text}`);
  }
  const data = JSON.parse(text) as {
    status?: string;
    completedDateTime?: string;
  };
  return {
    status: (data.status as EnvelopeStatus) ?? "created",
    signedAt: data.completedDateTime,
  };
}

/**
 * Download the combined signed document (PDF) for a completed envelope.
 * Used to archive the signed contract in the workspace's storage.
 */
export async function downloadSignedPdf(envelopeId: string): Promise<Buffer> {
  const token = await getAccessToken();
  const base = await getBaseUri(token);
  const res = await fetch(`${base}/envelopes/${envelopeId}/documents/combined`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/pdf",
    },
  });
  if (!res.ok) {
    throw new Error(
      `DocuSign document download failed (${res.status}): ${await res.text()}`
    );
  }
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Verify a DocuSign Connect webhook delivery.
 * DocuSign HMACs the RAW request body with the Connect secret (HMAC-SHA256)
 * and sends the base64 digest in X-DocuSign-Signature-1 (and -2/-3… when
 * multiple secrets are configured).
 */
export function verifyConnectSignature(
  rawBody: string | Buffer,
  signatures: string[] | undefined
): boolean {
  const secret = process.env.DOCUSIGN_CONNECT_SECRET;
  if (!secret) return false;
  if (!signatures || signatures.length === 0) return false;
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, "utf8");
  for (const sig of signatures) {
    const expected = crypto
      .createHmac("sha256", secret)
      .update(body)
      .digest("base64");
    const provided = Buffer.from(String(sig ?? ""), "base64");
    const expectedBuf = Buffer.from(expected, "base64");
    if (
      provided.length === expectedBuf.length &&
      crypto.timingSafeEqual(provided, expectedBuf)
    ) {
      return true;
    }
  }
  return false;
}

/** Build the HTML proposal document from a stored campaign row. */
export function buildProposalHtml(params: {
  title: string;
  tierName: string;
  price: number | null;
  url: string;
  location: string | null;
  executiveSummary: string;
  keywords: { keyword: string; searchVolume: number; difficulty: string; intent: string }[];
  deliverables: string[];
  calendar: { month: number; focusArea: string; pieces: { type: string; title: string }[] }[];
  signerName: string;
  signerEmail: string;
  preparedBy: string;
}): string {
  const rows = params.keywords
    .map(
      (k) =>
        `<tr><td>${escapeHtml(k.keyword)}</td><td>${k.searchVolume.toLocaleString()} (est.)</td><td>${escapeHtml(k.difficulty)} (est.)</td><td>${escapeHtml(k.intent)}</td></tr>`
    )
    .join("");

  const deliverables = (params.deliverables ?? [])
    .map((d) => `<li>${escapeHtml(d)}</li>`)
    .join("");

  const months = (params.calendar ?? [])
    .map(
      (m) =>
        `<h3>Month ${m.month}: ${escapeHtml(m.focusArea)}</h3><ul>${(m.pieces ?? [])
          .map((p) => `<li>${escapeHtml(p.title)} <em>(${escapeHtml(p.type)})</em></li>`)
          .join("")}</ul>`
    )
    .join("");

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(params.title)}</title>
<style>
  body { font-family: Georgia, 'Times New Roman', serif; color: #111; line-height: 1.5; margin: 48px; }
  h1 { font-size: 22px; margin-bottom: 4px; }
  h2 { font-size: 15px; margin-top: 28px; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
  h3 { font-size: 13px; margin-bottom: 6px; }
  table { border-collapse: collapse; width: 100%; font-size: 11px; }
  th, td { border: 1px solid #bbb; padding: 6px 8px; text-align: left; }
  .muted { color: #555; font-size: 12px; }
  .price { font-size: 18px; font-weight: bold; }
  .sign-box { margin-top: 64px; border-top: 1px solid #111; padding-top: 10px; font-size: 13px; }
</style></head>
<body>
  <h1>SEO Proposal — ${escapeHtml(params.tierName)}</h1>
  <p class="muted">Prepared for ${escapeHtml(params.signerName)} · ${escapeHtml(params.url)}${params.location ? ` · ${escapeHtml(params.location)}` : ""}</p>
  <p class="muted">Prepared by ${escapeHtml(params.preparedBy)}</p>
  <p class="price">${params.price == null ? "Custom Consult" : `$${params.price.toLocaleString()}/month`}</p>

  <h2>Executive Summary</h2>
  <p>${escapeHtml(params.executiveSummary)}</p>

  ${rows ? `<h2>Target Keywords</h2><table><thead><tr><th>Keyword</th><th>Volume</th><th>Difficulty</th><th>Intent</th></tr></thead><tbody>${rows}</tbody></table>
  <p class="muted">Volumes and difficulty are AI estimates from the site audit, not measured data.</p>` : ""}

  ${deliverables ? `<h2>Deliverables</h2><ul>${deliverables}</ul>` : ""}
  ${months ? `<h2>Proposed Content Calendar</h2>${months}` : ""}

  <h2>Terms of Service</h2>
  <ol style="font-size: 12px; line-height: 1.6;">
    <li><strong>Services.</strong> The agency will provide the services described in this proposal for the monthly fee stated above. Services begin once this agreement is signed and the initial payment is received.</li>
    <li><strong>Payment.</strong> Fees are billed monthly in advance. Payment is due within 15 days of the invoice date. Late payments may pause services until the account is current.</li>
    <li><strong>Term &amp; Cancellation.</strong> This agreement is a month-to-month engagement. Either party may cancel by providing <strong>at least 60 days written notice</strong> before the next billing cycle. Fees already paid for the notice period are non-refundable.</li>
    <li><strong>Client Responsibilities.</strong> The client agrees to provide timely access to website, analytics, and brand assets needed to perform the services, and to approve content within a reasonable timeframe so deadlines can be met.</li>
    <li><strong>Intellectual Property.</strong> Work product created for the client becomes the client's property upon full payment. The agency retains the right to use non-confidential results in its portfolio.</li>
    <li><strong>Third-Party Tools &amp; Platforms.</strong> Services rely on third-party platforms (search engines, social networks, CMSes, ad platforms). The agency is not liable for changes, outages, or policy updates made by those platforms.</li>
    <li><strong>Results Disclaimer.</strong> SEO and marketing results depend on market conditions and third-party algorithm changes; projected outcomes are estimates and not guarantees.</li>
    <li><strong>Limitation of Liability.</strong> The agency's total liability under this agreement is limited to fees paid in the three months preceding a claim. Neither party is liable for indirect or consequential damages.</li>
    <li><strong>Confidentiality.</strong> Both parties will keep confidential any proprietary information shared during the engagement and will not disclose it to third parties.</li>
    <li><strong>Governing Law.</strong> This agreement is governed by the laws of the agency's jurisdiction, and the parties consent to its courts for any disputes.</li>
  </ol>

  <p class="sign-box">I agree to engage the above services at the stated terms, including the Terms of Service above. <strong>SIGN_HERE_MARKER</strong></p>
  <p class="muted">By signing, ${escapeHtml(params.signerName)} (${escapeHtml(params.signerEmail)}) authorizes the agency to begin the campaign described above upon completion of this document.</p>
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
