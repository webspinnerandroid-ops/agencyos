import { inngest } from "@/lib/inngest/client";
import { createClient } from "@supabase/supabase-js";

/**
 * Weekly publishing-health email — Mondays 08:30 UTC (before the other
 * Monday digests). One email per tenant that had publishing activity in the
 * last 7 days, summarizing per client: drafts generated, posts scheduled,
 * published, failed, and failures that exhausted the auto-retry ladder.
 *
 * Cross-tenant by design — same trust model as the other allowlisted Inngest
 * workers (publish cron, reputation digest). All numbers come from local
 * tables (posts, publishing_logs); nothing calls external APIs. A missing
 * RESEND_API_KEY logs instead of failing, so the cron never errors on
 * delivery.
 */

interface ClientHealth {
  clientId: string;
  clientName: string;
  scheduled: number;
  published: number;
  /** Posts that published after ≥1 automatic retry this window. */
  recovered: number;
  failed: number;
  escalated: number;
  recentLogs: { success: number; failed: number };
}

interface TenantHealth {
  tenantId: string;
  clients: ClientHealth[];
  totals: {
    scheduled: number;
    published: number;
    recovered: number;
    failed: number;
    escalated: number;
  };
}

const MAX_RETRIES = 3; // keep in sync with retryFailedPublishes.ts

export const publishingHealthWeeklyEmail = inngest.createFunction(
  {
    id: "publishing-health-weekly-email",
    name: "Weekly publishing health email",
    triggers: [{ cron: "30 8 * * 1" }], // Mondays 08:30 UTC
  },
  async ({ step }) => {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
    return await step.run("publishing-health", () =>
      runWeeklyPublishingHealth(supabase)
    );
  }
);

export interface PublishingHealthOutcome {
  tenantsConsidered: number;
  tenantsEmailed: number;
  recipients: number;
  skippedNoNews: number;
  sendFailures: number;
}

/** Shared engine so a one-off trigger script can run the same send. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function runWeeklyPublishingHealth(supabase: any): Promise<PublishingHealthOutcome> {
  const outcome: PublishingHealthOutcome = {
    tenantsConsidered: 0,
    tenantsEmailed: 0,
    recipients: 0,
    skippedNoNews: 0,
    sendFailures: 0,
  };

  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();

  // Tenants with any post touched in the window — no activity, no email.
  const { data: activePosts, error } = await supabase
    .from("posts")
    .select("tenant_id")
    .gte("created_at", weekAgo)
    .limit(5000);
  if (error) {
    console.error("[publishingHealth] tenant sweep:", error.message);
    return outcome;
  }
  const tenantIds = [
    ...new Set<string>(
      (activePosts ?? []).map((r: { tenant_id: string }) => r.tenant_id)
    ),
  ];
  outcome.tenantsConsidered = tenantIds.length;

  for (const tenantId of tenantIds) {
    try {
      const health = await buildTenantHealth(supabase, tenantId, weekAgo);
      if (!health) {
        outcome.skippedNoNews += 1;
        continue;
      }
      const recipients = await resolveTenantRecipients(supabase, tenantId);
      if (recipients.length === 0) {
        console.log(`[publishingHealth] ${tenantId}: no recipients`);
        outcome.skippedNoNews += 1;
        continue;
      }
      outcome.recipients += recipients.length;

      const apiKey = process.env.RESEND_API_KEY;
      if (!apiKey) {
        console.log("[publishingHealth] logged only — RESEND_API_KEY not set");
        outcome.skippedNoNews += 1;
        continue;
      }
      const sent = await sendHealthEmail(recipients, health);
      if (sent) outcome.tenantsEmailed += 1;
      else outcome.sendFailures += 1;
    } catch (err) {
      console.error(`[publishingHealth] tenant ${tenantId} failed:`, err);
      outcome.sendFailures += 1;
    }
  }
  return outcome;
}

/** Build one tenant's per-client health, or null when nothing to report. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function buildTenantHealth(
  supabase: any,
  tenantId: string,
  weekAgo: string
): Promise<TenantHealth | null> {
  const weekStart = new Date(weekAgo);

  // Current status of posts created in the window + client names.
  const { data: posts, error } = await supabase
    .from("posts")
    .select("id, status, client_id, publish_retry_count")
    .eq("tenant_id", tenantId)
    .gte("created_at", weekAgo)
    .limit(5000);
  if (error) throw new Error(error.message);

  const { data: clientRows } = await supabase
    .from("clients")
    .select("id, name")
    .eq("tenant_id", tenantId);
  const clientNames = new Map<string, string>(
    (clientRows ?? []).map((c: { id: string; name: string }) => [c.id, c.name])
  );

  const byClient = new Map<string, ClientHealth>();
  const get = (clientId: string | null): ClientHealth => {
    const key = clientId ?? "unassigned";
    if (!byClient.has(key)) {
      byClient.set(key, {
        clientId: key,
        clientName: clientNames.get(key) ?? (key === "unassigned" ? "Unassigned" : key.slice(0, 8)),
        scheduled: 0,
        published: 0,
        recovered: 0,
        failed: 0,
        escalated: 0,
        recentLogs: { success: 0, failed: 0 },
      });
    }
    return byClient.get(key)!;
  };

  let sawActivity = false;
  for (const p of posts ?? []) {
    const c = get(p.client_id);
    sawActivity = true;
    if (p.status === "scheduled") c.scheduled += 1;
    else if (p.status === "published") c.published += 1;
    else if (p.status === "failed") {
      c.failed += 1;
      // Escalated = failed with the ladder maxed out.
      if ((p.publish_retry_count ?? 0) >= MAX_RETRIES) c.escalated += 1;
    } else continue; // drafts/approvals aren't "publishing health"
  }

  // Publishing-log activity in the window (captures retried/healed posts
  // created before the window too). Log rows don't carry client_id, so
  // attribute each attempt through its post's client in one batch fetch.
  const { data: logs } = await supabase
    .from("publishing_logs")
    .select("post_id, success, attempt_at")
    .eq("tenant_id", tenantId)
    .gte("attempt_at", weekAgo)
    .limit(5000);
  const logRows = (logs ?? []) as { post_id: string; success: boolean }[];
  const logPostIds = [...new Set(logRows.map((l) => l.post_id))];
  if (logPostIds.length > 0) {
    const { data: logPosts } = await supabase
      .from("posts")
      .select("id, client_id")
      .in("id", logPostIds.slice(0, 200));
    const postClient = new Map<string, string | null>(
      (logPosts ?? []).map((p: { id: string; client_id: string | null }) => [p.id, p.client_id])
    );
    for (const row of logRows) {
      const c = get(postClient.get(row.post_id) ?? null);
      if (row.success) c.recentLogs.success += 1;
      else c.recentLogs.failed += 1;
    }
  }

  if (!sawActivity) return null;

  // Recovered-from-failure: the retry sweeper's own "Failed publish
  // recovered" notifications in the window. This is precise regardless of
  // when the post was created (a post from weeks ago can be healed this
  // week) and survives the Retry-now reset of the ladder columns.
  const { data: recoveries } = await supabase
    .from("notifications")
    .select("link")
    .eq("tenant_id", tenantId)
    .eq("title", "Failed publish recovered")
    .gte("created_at", weekAgo)
    .limit(500);
  const recoveredPostIds = (recoveries ?? [])
    .map((r: { link: string | null }) => r.link ?? "")
    .filter((l: string) => l.startsWith("/dashboard/posts?post="))
    .map((l: string) => l.replace("/dashboard/posts?post=", ""));
  const uniqueRecovered = [...new Set<string>(recoveredPostIds)];
  if (uniqueRecovered.length > 0) {
    const { data: recPosts } = await supabase
      .from("posts")
      .select("id, client_id")
      .in("id", uniqueRecovered.slice(0, 200));
    for (const p of recPosts ?? []) {
      const row = p as { id: string; client_id: string | null };
      get(row.client_id).recovered += 1;
    }
  }

  const clients = [...byClient.values()].filter(
    (c) =>
      c.scheduled + c.published + c.failed + c.recovered > 0 ||
      c.recentLogs.success + c.recentLogs.failed > 0
  );
  if (clients.length === 0) return null;

  const totals = clients.reduce(
    (acc: TenantHealth["totals"], c: ClientHealth) => ({
      scheduled: acc.scheduled + c.scheduled,
      published: acc.published + c.published,
      recovered: acc.recovered + c.recovered,
      failed: acc.failed + c.failed,
      escalated: acc.escalated + c.escalated,
    }),
    { scheduled: 0, published: 0, recovered: 0, failed: 0, escalated: 0 }
  );
  return { tenantId, clients, totals };
}

/** Every user in the tenant, by email (deduped, capped) — digest pattern. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function resolveTenantRecipients(supabase: any, tenantId: string): Promise<string[]> {
  const { data: roles } = await supabase
    .from("user_roles")
    .select("user_id")
    .eq("tenant_id", tenantId);
  const userIds = [...new Set((roles ?? []).map((r: { user_id: string }) => r.user_id))].slice(0, 20);
  const emails = new Set<string>();
  for (const userId of userIds) {
    const { data: u } = await supabase.auth.admin.getUserById(userId);
    const email = u?.user?.email as string | undefined;
    if (email && email.includes("@")) emails.add(email.toLowerCase());
    if (emails.size >= 10) break;
  }
  return [...emails];
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildHealthHtml(health: TenantHealth): string {
  const rows = health.clients
    .map(
      (c) => `<tr>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;">${esc(c.clientName)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:center;">${c.scheduled}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:center;color:#16a34a;">${c.published}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:center;color:#16a34a;">${c.recovered > 0 ? c.recovered : "\u2014"}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:center;${c.failed > 0 ? "color:#b45309;font-weight:600;" : "color:#888;"}">${c.failed}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:center;${c.escalated > 0 ? "color:#dc2626;font-weight:600;" : "color:#888;"}">${c.escalated}</td>
      </tr>`
    )
    .join("");

  const headline =
    health.totals.failed === 0
      ? health.totals.recovered > 0
        ? `All clear — and ${health.totals.recovered} post(s) recovered from earlier failures. 🎉`
        : `Everything published cleanly this week. 🎉`
      : `${health.totals.failed} post(s) hit publish failures this week${health.totals.escalated > 0 ? `, ${health.totals.escalated} exhausted automatic retries` : " — the auto-retry ladder is working through them"}${health.totals.recovered > 0 ? ` · ${health.totals.recovered} recovered` : ""}.`;

  return `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;">
    <h2 style="margin:0 0 4px;">Weekly publishing health</h2>
    <p style="margin:0 0 16px;color:#555;font-size:14px;">${esc(headline)}</p>
    <table style="border-collapse:collapse;width:100%;font-size:14px;">
      <thead>
        <tr style="text-align:left;color:#666;">
          <th style="padding:6px 10px;border-bottom:2px solid #ddd;">Client</th>
          <th style="padding:6px 10px;border-bottom:2px solid #ddd;text-align:center;">Scheduled</th>
          <th style="padding:6px 10px;border-bottom:2px solid #ddd;text-align:center;">Published</th>
          <th style="padding:6px 10px;border-bottom:2px solid #ddd;text-align:center;">Recovered</th>
          <th style="padding:6px 10px;border-bottom:2px solid #ddd;text-align:center;">Failed</th>
          <th style="padding:6px 10px;border-bottom:2px solid #ddd;text-align:center;">Needs a human</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="margin:20px 0 4px;">
      <a href="${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/dashboard/scheduled" style="background:#4f46e5;color:#fff;padding:9px 16px;border-radius:6px;text-decoration:none;font-size:14px;">Open the Scheduled panel</a>
    </p>
    <p style="margin:8px 0 0;color:#888;font-size:12px;">
      "Recovered" counts posts that published on an automatic retry after an
      earlier failure (3-retry ladder, ~2.5 hours). "Needs a human" counts
      failures that exhausted the ladder — resolve them from the Scheduled panel.
    </p>
  </div>`;
}

async function sendHealthEmail(recipients: string[], health: TenantHealth): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL ?? "Agency OS <data@updates.blissmedialab.com>",
        to: recipients,
        subject: `Weekly publishing health — ${health.totals.published} published${
          health.totals.failed > 0 ? `, ${health.totals.failed} failed` : ""
        }`,
        html: buildHealthHtml(health),
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      console.error(`[publishingHealth] Resend ${res.status}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[publishingHealth] send failed:", (err as Error).message);
    return false;
  }
}
