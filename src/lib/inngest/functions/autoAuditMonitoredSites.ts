import { inngest } from "@/lib/inngest/client";
import { createClient } from "@supabase/supabase-js";
import { analyzeContent } from "@/lib/seo/analyzer";
import { createNotification } from "@/lib/in-app-notifications";

/**
 * Weekly auto-audit of monitored sites — Mondays 09:00 UTC.
 *
 * For every distinct URL in site_audits (mode = 'url'), re-runs the same
 * SEO/AEO/GEO analyzer the dashboard uses and persists a new row, so the
 * Monitored Sites dashboard tracks score trends without manual re-runs.
 * When the combined score changed vs the previous run, a bell notification
 * links back to the site's detail page. After each tenant's sites finish, a
 * summary email of the results goes to the workspace owner (Resend, with a
 * log fallback when no key is configured).
 *
 * The core logic lives in runAutoAudit so the scheduled job and the one-off
 * trigger script (scripts/run-auto-audit-once.ts) share one code path.
 */
export const autoAuditMonitoredSites = inngest.createFunction(
  {
    id: "auto-audit-monitored-sites",
    name: "Weekly auto-audit of monitored sites",
    triggers: [{ cron: "0 9 * * 1" }], // Mondays 09:00 UTC
  },
  async ({ step }) => {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
    return await step.run("auto-audit-all", () => runAutoAudit(supabase));
  }
);

export interface AutoAuditOutcome {
  audited: number;
  changed: number;
  skipped: number;
  emailed: number;
  sites: { tenantId: string; url: string; seo: number | null; aeo: number | null; geo: number | null; combined: number | null; changed: boolean; skipped: boolean }[];
}

/** Shared engine used by the weekly cron and the one-off trigger script. */
export async function runAutoAudit(
  supabase: any
): Promise<AutoAuditOutcome> {
  const rows = await supabase
    .from("site_audits")
    .select("tenant_id, url, created_at")
    .eq("mode", "url")
    .not("url", "is", null)
    .order("created_at", { ascending: false })
    .limit(5000);
  if (rows.error) throw new Error(`Query failed: ${rows.error.message}`);
  const allRows = (rows.data ?? []) as { tenant_id: string; url: string | null; created_at: string }[];

  // Latest audit per (tenant, url).
  const seen = new Map<string, { tenant_id: string; url: string }>();
  for (const row of allRows) {
    if (!row.url) continue;
    const key = `${row.tenant_id}|${row.url}`;
    if (!seen.has(key)) seen.set(key, { tenant_id: row.tenant_id, url: row.url });
  }
  const sites = [...seen.values()];

  const outcome: AutoAuditOutcome = {
    audited: 0,
    changed: 0,
    skipped: 0,
    emailed: 0,
    sites: [],
  };
  if (sites.length === 0) return outcome;

  // Group sites by tenant so each tenant gets one digest email at the end.
  const byTenant = new Map<string, { tenant_id: string; url: string }[]>();
  for (const site of sites) {
    const list = byTenant.get(site.tenant_id) ?? [];
    list.push(site);
    byTenant.set(site.tenant_id, list);
  }

  for (const [tenantId, tenantSites] of byTenant) {
    const results: AutoAuditOutcome["sites"] = [];
    for (const site of tenantSites) {
      const prev = await supabase
        .from("site_audits")
        .select("seo_score, aeo_score, geo_score")
        .eq("tenant_id", site.tenant_id)
        .eq("url", site.url)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const prevScores = prev.data as { seo_score: number | null; aeo_score: number | null; geo_score: number | null } | null;

      let result;
      try {
        result = await analyzeContent({ url: site.url });
      } catch (err) {
        outcome.skipped++;
        console.warn(
          `[autoAuditMonitoredSites] analyze failed for ${site.url}:`,
          (err as Error).message
        );
        results.push({ tenantId, url: site.url, seo: null, aeo: null, geo: null, combined: null, changed: false, skipped: true });
        continue;
      }

      const failed = [
        ...(result.seo?.checks ?? []),
        ...(result.aeoGeo?.checks ?? []),
      ].filter((c) => !c.passed).length;

      const { error: insertErr } = await supabase.from("site_audits").insert({
        tenant_id: site.tenant_id,
        mode: "url",
        url: result.url ?? site.url,
        title: result.title.slice(0, 300),
        keyword: result.keyword,
        seo_score: result.seo?.total ?? null,
        aeo_score: result.aeoGeo?.aeoScore ?? null,
        geo_score: result.aeoGeo?.geoSscore ?? null,
        word_count: result.wordCount,
        issues: failed,
        checks_json: {
          seo: result.seo?.checks ?? [],
          aeoGeo: result.aeoGeo?.checks ?? [],
        },
        fetched: result.fetched ?? null,
        fetch_error: result.fetchError?.slice(0, 500) ?? null,
      });
      if (insertErr) {
        outcome.skipped++;
        console.warn(`[autoAuditMonitoredSites] insert failed for ${site.url}:`, insertErr.message);
        results.push({ tenantId, url: site.url, seo: null, aeo: null, geo: null, combined: null, changed: false, skipped: true });
        continue;
      }
      outcome.audited++;

      const prevTotal = prevScores
        ? (prevScores.seo_score ?? 0) + (prevScores.aeo_score ?? 0) + (prevScores.geo_score ?? 0)
        : null;
      const newTotal =
        (result.seo?.total ?? 0) + (result.aeoGeo?.aeoScore ?? 0) + (result.aeoGeo?.geoSscore ?? 0);
      const changed = prevTotal != null && newTotal !== prevTotal;

      results.push({
        tenantId,
        url: site.url,
        seo: result.seo?.total ?? null,
        aeo: result.aeoGeo?.aeoScore ?? null,
        geo: result.aeoGeo?.geoSscore ?? null,
        combined: newTotal,
        changed,
        skipped: false,
      });

      if (changed) {
        outcome.changed++;
        await createNotification({
          tenantId: site.tenant_id,
          kind: "info",
          title: "Weekly audit complete",
          body:
            prevTotal == null
              ? `${site.url} — first audit: SEO ${result.seo?.total ?? "—"} / AEO ${result.aeoGeo?.aeoScore ?? "—"} / GEO ${result.aeoGeo?.geoSscore ?? "—"}.`
              : `${site.url} — combined score ${prevTotal} → ${newTotal} (${newTotal - prevTotal >= 0 ? "+" : ""}${newTotal - prevTotal}) since last week's audit.`,
          link: `/dashboard/seo/sites?url=${encodeURIComponent(site.url)}`,
          groupKey: `site-audit:${site.url}`,
        });
      }
    }

    // One summary email per tenant to the workspace owner.
    const emailed = await sendAuditDigestEmail(supabase, tenantId, results);
    outcome.emailed += emailed ? 1 : 0;
    outcome.sites.push(...results);
  }

  return outcome;
}

/**
 * Email the weekly audit digest to the tenant's workspace owner (agency_admin
 * role; falls back to super_admin, then ADMIN_EMAIL). Direct Resend send —
 * logs when RESEND_API_KEY or a recipient is missing so the job never fails
 * on delivery.
 */
async function sendAuditDigestEmail(
  supabase: any,
  tenantId: string,
  results: AutoAuditOutcome["sites"]
): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log(`[autoAuditMonitoredSites] digest for tenant ${tenantId} logged only — RESEND_API_KEY not set`);
    return false;
  }

  const done = results.filter((r) => !r.skipped);
  if (done.length === 0) return false;

  const recipient = await resolveTenantOwnerEmail(supabase, tenantId);
  if (!recipient) {
    console.log(`[autoAuditMonitoredSites] digest for tenant ${tenantId} not sent — no owner email found`);
    return false;
  }

  const rows = done
    .map((r) => {
      const label = r.url.replace(/^https?:\/\//, "").replace(/\/$/, "");
      const delta = r.changed
        ? `<span style="color:#16a34a;">${r.combined} (changed)</span>`
        : `<span style="color:#6b7280;">${r.combined ?? "—"} (no change)</span>`;
      return `<tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${escapeHtml(label)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;">${r.seo ?? "—"}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;">${r.aeo ?? "—"}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;">${r.geo ?? "—"}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;">${delta}</td>
      </tr>`;
    })
    .join("");

  const changedCount = done.filter((r) => r.changed).length;
  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:640px;margin:0 auto;">
      <h2 style="margin:0 0 4px;">Weekly site audit digest</h2>
      <p style="color:#6b7280;margin:0 0 16px;">
        ${done.length} monitored site(s) re-audited · ${changedCount} score change(s) this week
      </p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead>
          <tr style="text-align:left;background:#f9fafb;">
            <th style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">Site</th>
            <th style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;">SEO</th>
            <th style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;">AEO</th>
            <th style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;">GEO</th>
            <th style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;">Combined</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="margin:16px 0 0;">
        <a href="${process.env.NEXT_PUBLIC_APP_URL ?? "https://platform.blissmedialab.com"}/dashboard/seo/sites"
           style="display:inline-block;background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;">
          Open Monitored Sites
        </a>
      </p>
      <p style="color:#6b7280;font-size:12px;margin-top:24px;">— Agency OS</p>
    </div>`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL ?? "Agency OS <alerts@updates.blissmedialab.com>",
        to: [recipient],
        subject: `Weekly site audit digest — ${done.length} site(s), ${changedCount} change(s)`,
        html,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const body = (await res.text().catch(() => "")).slice(0, 150);
      console.error(`[autoAuditMonitoredSites] digest email failed (${res.status}): ${body}`);
      return false;
    }
    console.log(`[autoAuditMonitoredSites] digest emailed to ${recipient}`);
    return true;
  } catch (err) {
    console.error("[autoAuditMonitoredSites] digest send failed:", (err as Error).message);
    return false;
  }
}

/**
 * Resolve the workspace owner's email: the tenant's agency_admin role (the
 * account created at registration), falling back to super_admin, then
 * ADMIN_EMAIL env.
 */
async function resolveTenantOwnerEmail(
  supabase: any,
  tenantId: string
): Promise<string | null> {
  try {
    const { data: roles } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("tenant_id", tenantId)
      .eq("role", "agency_admin")
      .limit(10);
    let ownerIds = new Set<string>((roles ?? []).map((r: any) => r.user_id));

    if (ownerIds.size === 0) {
      const { data: admins } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "super_admin");
      ownerIds = new Set((admins ?? []).map((r: any) => r.user_id));
    }
    if (ownerIds.size === 0) return process.env.ADMIN_EMAIL ?? null;

    const { data: users } = await supabase.auth.admin.listUsers();
    const email = (users?.users ?? [])
      .filter((u: any) => ownerIds.has(u.id))
      .map((u: any) => u.email)
      .find(Boolean);
    return email ?? process.env.ADMIN_EMAIL ?? null;
  } catch (err) {
    console.error("[autoAuditMonitoredSites] owner email lookup failed:", (err as Error).message);
    return process.env.ADMIN_EMAIL ?? null;
  }
}

const HTML_ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>]/g, (ch) => HTML_ESCAPE_MAP[ch]);
}
