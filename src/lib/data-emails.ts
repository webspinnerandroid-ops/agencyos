/**
 * Data-lifecycle email helpers (Resend).
 *
 * Covers the emails a store/Meta/Google compliance flow needs:
 *   - a confirmation to the person who requested data deletion
 *   - a summary to super admins when a request is processed
 *   - a GDPR export archive (JSON attachment) to the requesting user
 *
 * All sends fall back to a log line when RESEND_API_KEY isn't configured so
 * the request flow never breaks just because email is off.
 */

const FROM = process.env.RESEND_FROM_EMAIL ?? "Agency OS <data@updates.blissmedialab.com>";

export interface EmailSendResult {
  sent: boolean;
  detail: string;
}

async function sendResend(params: {
  to: string;
  subject: string;
  html: string;
  attachment?: { filename: string; content: string; type: string };
}): Promise<EmailSendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log(
      `[data-emails] not emailed (no RESEND_API_KEY) → ${params.to}: ${params.subject}`
    );
    return { sent: false, detail: "logged only — no RESEND_API_KEY configured" };
  }
  try {
    const body: Record<string, unknown> = {
      from: FROM,
      to: [params.to],
      subject: params.subject,
      html: params.html,
    };
    if (params.attachment) {
      body.attachments = [
        {
          filename: params.attachment.filename,
          content: Buffer.from(params.attachment.content).toString("base64"),
          type: params.attachment.type,
        },
      ];
    }
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      const text = (await res.text().catch(() => "")).slice(0, 200);
      console.error(`[data-emails] Resend failed (${res.status}): ${text}`);
      return { sent: false, detail: `Resend HTTP ${res.status}` };
    }
    return { sent: true, detail: `emailed ${params.to}` };
  } catch (err) {
    console.error("[data-emails] send failed:", (err as Error).message);
    return { sent: false, detail: (err as Error).message };
  }
}

/** Confirmation to the person who requested deletion of their data. */
export function emailDeletionConfirmation(params: {
  toEmail: string;
  reason?: string;
}): Promise<EmailSendResult> {
  return sendResend({
    to: params.toEmail,
    subject: "We received your data deletion request",
    html: `<p>Hi,</p>
      <p>We received your request to delete your data${params.reason ? ` (reason: ${escapeHtml(params.reason.slice(0, 500))})` : ""}.</p>
      <p>We will process it within <strong>30 days</strong> and confirm here by email once complete.</p>
      <p>If you are a signed-in user you can also delete your account or export your data at any time from your profile settings.</p>
      <p style="color:#666;font-size:13px;">If you didn't make this request, you can ignore this email.</p>`,
  });
}

/** Confirmation that the account was actually deleted (sent after the fact). */
export function emailDeletionComplete(params: {
  toEmail: string;
}): Promise<EmailSendResult> {
  return sendResend({
    to: params.toEmail,
    subject: "Your account and data have been deleted",
    html: `<p>Hi,</p>
      <p>As requested, your account and associated data have now been <strong>permanently deleted</strong> from our systems.</p>
      <p>You will no longer be able to sign in, and any remaining data tied to the account has been removed.</p>
      <p style="color:#666;font-size:13px;">If this wasn't you, contact support immediately.</p>`,
  });
}

/** Summary to super admins when a deletion request has been processed. */
export function emailDeletionProcessed(params: {
  toEmail: string;
  subject: string;
  html: string;
}): Promise<EmailSendResult> {
  return sendResend({ to: params.toEmail, subject: params.subject, html: params.html });
}

/** GDPR export — emails the requesting user a JSON archive of their data. */
export function emailDataExport(params: {
  toEmail: string;
  archiveJson: string;
}): Promise<EmailSendResult> {
  const pretty = JSON.stringify(JSON.parse(params.archiveJson), null, 2);
  return sendResend({
    to: params.toEmail,
    subject: "Your data export is ready",
    html: `<p>Hi,</p>
      <p>As requested, here is a JSON archive of the data associated with your account. It is attached to this email.</p>
      <p>You can import it into another service or keep it for your records.</p>
      <p style="color:#666;font-size:13px;">This archive was generated at ${new Date().toISOString()}.</p>`,
    attachment: {
      filename: "agencyos-data-export.json",
      content: pretty,
      type: "application/json",
    },
  });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
