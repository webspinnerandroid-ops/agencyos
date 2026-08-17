import { inngest } from "@/lib/inngest/client";
import { createClient } from "@supabase/supabase-js";
import { computeAssetHealth, type WorkspaceAssetHealth } from "@/lib/asset-health";

/**
 * Weekly per-workspace asset health email — Mondays 09:30 UTC (right after
 * the weekly site audit at 09:00). Runs the same magic-byte smoke test the
 * Admin panel and CI use, then emails the summary to every super admin
 * (falling back to ADMIN_EMAIL). A Resend key is required to actually send;
 * otherwise it logs and exits cleanly so the cron never fails on delivery.
 */
export const assetHealthWeeklyEmail = inngest.createFunction(
  {
    id: "asset-health-weekly-email",
    name: "Weekly per-workspace asset health email",
    triggers: [{ cron: "30 9 * * 1" }], // Mondays 09:30 UTC
  },
  async ({ step }) => {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
    return await step.run("asset-health-summary", () => runWeeklyAssetHealthEmail(supabase));
  }
);

export interface AssetHealthEmailOutcome {
  emailed: number;
  recipients: number;
  problems: number;
  totalAssets: number;
}

/** Shared engine so a one-off trigger script can run the same send. */
export async function runWeeklyAssetHealthEmail(
  supabase: any
): Promise<AssetHealthEmailOutcome> {
  const summary = await computeAssetHealth(supabase);
  const problems = summary.filter(
    (s) => s.broken > 0 || s.emptyUrl > 0 || s.nonCdn > 0
  );
  const totalAssets = summary.reduce((n, s) => n + s.total, 0);

  const recipients = await resolveSuperAdminEmails(supabase);
  if (recipients.length === 0) {
    console.log("[assetHealthWeeklyEmail] not sent — no super-admin email found");
    return { emailed: 0, recipients: 0, problems: problems.length, totalAssets };
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log("[assetHealthWeeklyEmail] logged only — RESEND_API_KEY not set");
    return { emailed: 0, recipients: recipients.length, problems: problems.length, totalAssets };
  }

  const html = buildSummaryHtml(summary, problems, totalAssets);

  let emailed = 0;
  for (const to of recipients) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: process.env.RESEND_FROM_EMAIL ?? "Agency OS <data@updates.blissmedialab.com>",
          to: [to],
          subject: `Asset health summary — ${problems.length} workspace(s) need attention`,
          html,
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok) emailed++;
      else console.error(`[assetHealthWeeklyEmail] Resend ${res.status} for ${to}`);
    } catch (err) {
      console.error("[assetHealthWeeklyEmail] send failed:", (err as Error).message);
    }
  }

  return { emailed, recipients: recipients.length, problems: problems.length, totalAssets };
}

async function resolveSuperAdminEmails(supabase: any): Promise<string[]> {
  try {
    const { data: admins } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "super_admin");
    const ids = new Set<string>((admins ?? []).map((r: any) => r.user_id));
    if (ids.size > 0) {
      const { data: users } = await supabase.auth.admin.listUsers();
      const emails: string[] = (users?.users ?? [])
        .filter((u: any) => ids.has(u.id))
        .map((u: any) => String(u.email ?? ""))
        .filter(Boolean);
      if (emails.length > 0) return [...new Set(emails)];
    }
    return process.env.ADMIN_EMAIL ? [process.env.ADMIN_EMAIL] : [];
  } catch (err) {
    console.error("[assetHealthWeeklyEmail] super-admin lookup failed:", (err as Error).message);
    return process.env.ADMIN_EMAIL ? [process.env.ADMIN_EMAIL] : [];
  }
}

function buildSummaryHtml(
  summary: WorkspaceAssetHealth[],
  problems: WorkspaceAssetHealth[],
  totalAssets: number
): string {
  const rows = summary
    .map((s) => {
      const hasIssue = s.broken > 0 || s.emptyUrl > 0 || s.nonCdn > 0;
      const status = hasIssue
        ? `<span style="color:#dc2626;font-weight:600;">${s.broken + s.emptyUrl + s.nonCdn} issue(s)</span>`
        : `<span style="color:#16a34a;">Healthy</span>`;
      return `<tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${escapeHtml(s.tenantName)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${escapeHtml(s.workspaceName)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;">${s.total}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;">${s.ok}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;">${s.broken}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;">${s.emptyUrl}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;">${s.nonCdn}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;">${status}</td>
      </tr>`;
    })
    .join("");

  const problemsList =
    problems.length === 0
      ? `<p style="color:#16a34a;">No workspaces have broken assets. 🎉</p>`
      : `<ul style="padding-left:18px;margin:8px 0;">${problems
          .map(
            (p) =>
              `<li>${escapeHtml(p.tenantName)} / ${escapeHtml(p.workspaceName)} — ${p.broken} broken, ${p.emptyUrl} empty URL, ${p.nonCdn} non-CDN</li>`
          )
          .join("")}</ul>`;

  return `
    <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:680px;margin:0 auto;">
      <h2 style="margin:0 0 4px;">Weekly asset health summary</h2>
      <p style="color:#6b7280;margin:0 0 16px;">
        ${totalAssets} stored asset(s) across ${summary.length} workspace(s) · ${problems.length} workspace(s) need attention
      </p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead>
          <tr style="text-align:left;background:#f9fafb;">
            <th style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">Tenant</th>
            <th style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">Workspace</th>
            <th style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;">Total</th>
            <th style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;">Healthy</th>
            <th style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;">Broken</th>
            <th style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;">Empty</th>
            <th style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;">Non-CDN</th>
            <th style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;">Status</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <h3 style="margin:20px 0 4px;">Workspaces needing attention</h3>
      ${problemsList}
      <p style="margin:16px 0 0;">
        <a href="${process.env.NEXT_PUBLIC_APP_URL ?? "https://platform.blissmedialab.com"}/dashboard/admin"
           style="display:inline-block;background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;">
          Open Admin → Asset Health
        </a>
      </p>
      <p style="color:#6b7280;font-size:12px;margin-top:24px;">— Agency OS</p>
    </div>`;
}

const HTML_ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>]/g, (ch) => HTML_ESCAPE_MAP[ch]);
}
