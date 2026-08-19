// ------------------------------------------------------------------
// Email Notification Utilities (SMTP / Resend placeholder)
//
// Replace the placeholder implementations below with real SMTP
// transport (nodemailer) or the Resend SDK when you're ready to
// send live emails.
//
// Required environment variables (when enabling real delivery):
//   SMTP_HOST      – e.g. smtp.resend.com or your SMTP server
//   SMTP_PORT      – e.g. 587
//   SMTP_USER      – SMTP username / Resend API key
//   SMTP_PASS      – SMTP password
//   SMTP_FROM      – sender address, e.g. "Agency OS <no-reply@agency.com>"
//   RESEND_API_KEY – alternative if using the Resend SDK directly
// ------------------------------------------------------------------

export interface NotificationRecipient {
  email: string;
  name?: string;
}

export interface PostNotification {
  postId: string;
  postContent: string;
  clientName: string;
  postUrl: string;
}

// ------------------------------------------------------------------
// notifyPostReadyForApproval
// Sent to the client when a post moves to "pending_approval".
// ------------------------------------------------------------------
export async function notifyPostReadyForApproval(
  recipient: NotificationRecipient,
  post: PostNotification
): Promise<void> {
  const html = `
    <p>Hi ${recipient.name ?? "there"},</p>
    <p>A new post is ready for your review:</p>
    <blockquote style="background:#f3f4f6;padding:12px;border-radius:6px;">
      ${escapeHtml(post.postContent.slice(0, 300))}${
    post.postContent.length > 300 ? "\u2026" : ""
  }
    </blockquote>
    <p>
      <a href="${post.postUrl}" style="display:inline-block;background:#3b82f6;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;">
        Review Post
      </a>
    </p>
    <p style="color:#6b7280;font-size:14px;">
      \u2014 ${post.clientName} \u00b7 Agency OS
    </p>
  `;

  await sendEmail({
    to: recipient.email,
    subject: `Post ready for your review \u2014 ${post.clientName}`,
    html,
  });
}

// ------------------------------------------------------------------
// notifyPostApproved
// Sent when a post is approved by the client.
// ------------------------------------------------------------------
export async function notifyPostApproved(
  recipient: NotificationRecipient,
  post: PostNotification
): Promise<void> {
  const html = `
    <p>Hi ${recipient.name ?? "there"},</p>
    <p>A post has been <strong>approved</strong> and is now queued for publishing:</p>
    <blockquote style="background:#f3f4f6;padding:12px;border-radius:6px;">
      ${escapeHtml(post.postContent.slice(0, 300))}${
    post.postContent.length > 300 ? "\u2026" : ""
  }
    </blockquote>
    <p>
      <a href="${post.postUrl}" style="display:inline-block;background:#22c55e;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;">
        View Post
      </a>
    </p>
    <p style="color:#6b7280;font-size:14px;">
      \u2014 ${post.clientName} \u00b7 Agency OS
    </p>
  `;

  await sendEmail({
    to: recipient.email,
    subject: `Post approved \u2014 ${post.clientName}`,
    html,
  });
}

// ------------------------------------------------------------------
// notifyPostNeedsRevision
// Sent when a client requests a revision (comment body included).
// ------------------------------------------------------------------
export async function notifyPostNeedsRevision(
  recipient: NotificationRecipient,
  post: PostNotification,
  comment: string
): Promise<void> {
  const html = `
    <p>Hi ${recipient.name ?? "there"},</p>
    <p>A post has been marked as <strong style="color:#f97316;">needs revision</strong>:</p>
    <blockquote style="background:#f3f4f6;padding:12px;border-radius:6px;">
      ${escapeHtml(post.postContent.slice(0, 300))}${
    post.postContent.length > 300 ? "\u2026" : ""
  }
    </blockquote>
    <p><strong>Client feedback:</strong></p>
    <blockquote style="background:#fff7ed;border-left:3px solid #f97316;padding:12px;border-radius:4px;">
      ${escapeHtml(comment)}
    </blockquote>
    <p>
      <a href="${post.postUrl}" style="display:inline-block;background:#f97316;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;">
        Edit Post
      </a>
    </p>
    <p style="color:#6b7280;font-size:14px;">
      \u2014 ${post.clientName} \u00b7 Agency OS
    </p>
  `;

  await sendEmail({
    to: recipient.email,
    subject: `Revision requested for a post \u2014 ${post.clientName}`,
    html,
  });
}

// ------------------------------------------------------------------
// notifyCommentAdded
// Generic notification when a new comment is added to a post.
// ------------------------------------------------------------------
export async function notifyCommentAdded(
  recipient: NotificationRecipient,
  post: PostNotification,
  comment: string,
  commentAuthor: string
): Promise<void> {
  const html = `
    <p>Hi ${recipient.name ?? "there"},</p>
    <p><strong>${escapeHtml(commentAuthor)}</strong> added a comment:</p>
    <blockquote style="background:#f3f4f6;padding:12px;border-radius:6px;">
      ${escapeHtml(comment)}
    </blockquote>
    <p>
      <a href="${post.postUrl}" style="display:inline-block;background:#3b82f6;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;">
        View Discussion
      </a>
    </p>
    <p style="color:#6b7280;font-size:14px;">
      \u2014 ${post.clientName} \u00b7 Agency OS
    </p>
  `;

  await sendEmail({
    to: recipient.email,
    subject: `New comment on your post \u2014 ${post.clientName}`,
    html,
  });
}

// ==================================================================
// Private helpers
// ==================================================================

interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail(_params: SendEmailParams): Promise<void> {
  const { to, subject, html } = _params;

  // Deliver over SMTP (nodemailer) when configured; otherwise log and skip so
  // callers can safely fire-and-forget without crashing when mail is off.
  if (!process.env.SMTP_HOST) {
    console.log("\uD83D\uDCE7 [EMAIL NOTIFICATION] (SMTP_HOST not set — not sent)", {
      to,
      subject,
      htmlPreview: html.slice(0, 120),
    });
    return;
  }

  try {
    const nodemailer = (await import("nodemailer")).default;
    const port = Number(process.env.SMTP_PORT || 587);
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    });
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject,
      html,
    });
  } catch (err) {
    console.error("[EMAIL NOTIFICATION] send failed:", err instanceof Error ? err.message : err);
  }
}

const HTML_ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#x27;",
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => HTML_ESCAPE_MAP[ch]);
}