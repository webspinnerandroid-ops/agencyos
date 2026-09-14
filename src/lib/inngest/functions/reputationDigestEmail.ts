import { inngest } from "@/lib/inngest/client";
import { createClient } from "@supabase/supabase-js";

/**
 * Weekly reputation digest — Mondays 10:00 UTC. One email per tenant that has
 * connected Business Profile listings AND something worth reporting: new
 * reviews from the last 7 days or reviews still awaiting a public reply.
 *
 * Cross-tenant by design (it sweeps every tenant with connected listings and
 * resolves each tenant's recipients) — same trust model as the other
 * allowlisted Inngest workers. All data comes from the local gbp_reviews
 * snapshots; the digest never calls Google.
 */

interface BusinessDigest {
  name: string;
  newCount: number;
  newAvg: number | null;
  unanswered: number;
}

interface DigestReviewLine {
  /** First 8 chars of the review row's UUID — the reply-routing token. */
  id8: string;
  reviewer: string;
  stars: number;
  comment: string | null;
  replied: boolean;
  businessName: string;
}

interface TenantDigest {
  tenantId: string;
  businesses: BusinessDigest[];
  newTotal: number;
  unansweredTotal: number;
  /** New 1-3★ reviews this week, for the reply-by-email section. */
  lowStars: DigestReviewLine[];
}

const starWord = (word: string): number =>
  ({ ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 }[word] ?? 0);

export const reputationDigestEmail = inngest.createFunction(
  {
    id: "reputation-digest-email",
    name: "Weekly reputation digest email",
    retries: 2,
    triggers: [{ cron: "0 10 * * 1" }], // Mondays 10:00 UTC
  },
  async ({ step }) => {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
    return await step.run("reputation-digest", () => runWeeklyReputationDigest(supabase));
  }
);

export interface ReputationDigestOutcome {
  tenantsConsidered: number;
  tenantsEmailed: number;
  recipients: number;
  skippedNoNews: number;
  sendFailures: number;
}

/** Shared engine so a one-off trigger script can run the same send. */
export async function runWeeklyReputationDigest(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
): Promise<ReputationDigestOutcome> {
  const outcome: ReputationDigestOutcome = {
    tenantsConsidered: 0,
    tenantsEmailed: 0,
    recipients: 0,
    skippedNoNews: 0,
    sendFailures: 0,
  };

  // Distinct tenants with connected listings.
  const { data: profileRows, error: profErr } = await supabase
    .from("google_business_profiles")
    .select("tenant_id")
    .eq("connected", true)
    .not("location_id", "is", null);
  if (profErr) {
    console.error("[reputationDigest] profiles sweep:", profErr.message);
    return outcome;
  }
  const tenantIds = [
    ...new Set(
      ((profileRows ?? []) as { tenant_id: string }[]).map((r) => r.tenant_id)
    ),
  ];
  outcome.tenantsConsidered = tenantIds.length;

  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();

  for (const tenantId of tenantIds) {
    try {
      const digest = await buildTenantDigest(supabase, tenantId, weekAgo);
      if (!digest) {
        outcome.skippedNoNews += 1;
        continue;
      }

      const recipients = await resolveTenantRecipients(supabase, tenantId);
      if (recipients.length === 0) {
        console.log(`[reputationDigest] ${tenantId}: no recipient emails found`);
        outcome.skippedNoNews += 1;
        continue;
      }
      outcome.recipients += recipients.length;

      const apiKey = process.env.RESEND_API_KEY;
      if (!apiKey) {
        console.log("[reputationDigest] logged only — RESEND_API_KEY not set");
        outcome.skippedNoNews += 1;
        continue;
      }

      const sent = await sendDigest(recipients, digest);
      if (sent) outcome.tenantsEmailed += 1;
      else outcome.sendFailures += 1;
    } catch (err) {
      console.error(`[reputationDigest] tenant ${tenantId} failed:`, err);
      outcome.sendFailures += 1;
    }
  }

  return outcome;
}

/** Build one tenant's digest, or null when there's nothing worth emailing. */
async function buildTenantDigest(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  tenantId: string,
  weekAgoIso: string
): Promise<TenantDigest | null> {
  const { data: profiles } = await supabase
    .from("google_business_profiles")
    .select("id, account_name")
    .eq("tenant_id", tenantId)
    .eq("connected", true)
    .not("location_id", "is", null);
  const profileList = profiles ?? [];
  if (profileList.length === 0) return null;
  const names = new Map(
    (
      profileList as { id: string; account_name: string | null }[]
    ).map((p) => [p.id, p.account_name ?? "Business Profile"] as [string, string])
  );

  const { data: reviews, error } = await supabase
    .from("gbp_reviews")
    .select("id, profile_id, star_rating, create_time, replied, comment, reviewer_name")
    .eq("tenant_id", tenantId)
    .in("profile_id", profileList.map((p: { id: string }) => p.id))
    .order("create_time", { ascending: false, nullsFirst: false })
    .limit(2000);
  if (error) throw new Error(error.message);
  const rows = (reviews ?? []) as {
    id: string;
    profile_id: string;
    star_rating: string;
    create_time: string | null;
    replied: boolean | null;
    comment: string | null;
    reviewer_name: string | null;
  }[];

  const byBusiness = new Map<string, BusinessDigest>();
  for (const p of profileList) {
    byBusiness.set(p.id, { name: names.get(p.id)!, newCount: 0, newAvg: null, unanswered: 0 });
  }
  const weekStars: Record<string, { sum: number; n: number }> = {};
  const lowStars: DigestReviewLine[] = [];
  for (const r of rows) {
    const b = byBusiness.get(r.profile_id);
    if (!b) continue;
    if (!r.replied) b.unanswered += 1;
    if (r.create_time && r.create_time >= weekAgoIso) {
      b.newCount += 1;
      const stars = starWord(r.star_rating);
      if (stars > 0) {
        const agg = (weekStars[r.profile_id] ??= { sum: 0, n: 0 });
        agg.sum += stars;
        agg.n += 1;
      }
      if (stars > 0 && stars <= 3) {
        lowStars.push({
          id8: r.id.slice(0, 8),
          reviewer: r.reviewer_name ?? "Google user",
          stars,
          comment: r.comment,
          replied: !!r.replied,
          businessName: b.name,
        });
      }
    }
  }
  for (const [id, agg] of Object.entries(weekStars)) {
    const b = byBusiness.get(id);
    if (b && agg.n > 0) b.newAvg = Math.round((agg.sum / agg.n) * 10) / 10;
  }

  const businesses = [...byBusiness.values()].filter((b) => b.newCount > 0 || b.unanswered > 0);
  if (businesses.length === 0) return null;
  return {
    tenantId,
    businesses,
    newTotal: businesses.reduce((s, b) => s + b.newCount, 0),
    unansweredTotal: businesses.reduce((s, b) => s + b.unanswered, 0),
    lowStars: lowStars.sort((a, b) => a.stars - b.stars).slice(0, 5),
  };
}

/** Every user in the tenant, by email (deduped, capped). */
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

/** Reply-to-note rows for this week's low-star reviews (newest last). */
function buildLowStarHtml(digest: TenantDigest): string {
  if (digest.lowStars.length === 0) return "";
  const items = digest.lowStars
    .map((r) => {
      const open = '<li style="margin:0 0 8px;">';
      const name = '<span style="color:#b45309;font-weight:600;">' + r.stars + '\u2605</span> ' +
        esc(r.reviewer) + ' on <strong>' + esc(r.businessName) + '</strong>' +
        (r.replied ? ' <span style="color:#16a34a;">(replied \u2713)</span>' : '');
      const quote = r.comment
        ? '<div style="color:#666;font-size:13px;margin:2px 0 0;">' +
          esc(r.comment.slice(0, 140)) + (r.comment.length > 140 ? '\u2026' : '') + '</div>'
        : '';
      const hint = '<div style="color:#999;font-size:12px;margin:2px 0 0;">Reply to this email with <code>[Re:#' +
        r.id8 + ']</code> anywhere in your message to add a private note to this review.</div>';
      return open + name + quote + hint + '</li>';
    })
    .join("");
  return (
    '<h3 style="margin:24px 0 8px;font-size:15px;">Worth a look this week</h3>' +
    '<ul style="padding-left:18px;margin:0;font-size:14px;">' + items + '</ul>'
  );
}

function buildDigestHtml(digest: TenantDigest): string {
  const rows = digest.businesses
    .map(
      (b) => `<tr>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;">${esc(b.name)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:center;">${b.newCount}${b.newAvg != null ? ` <span style="color:#888;">(avg ${b.newAvg}★)</span>` : ""}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:center;${b.unanswered > 0 ? "color:#b45309;font-weight:600;" : "color:#16a34a;"}">${b.unanswered}</td>
      </tr>`
    )
    .join("");
  return `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;">
    <h2 style="margin:0 0 4px;">Weekly reputation digest</h2>
    <p style="margin:0 0 16px;color:#555;font-size:14px;">
      ${digest.newTotal} new review${digest.newTotal === 1 ? "" : "s"} this week ·
      ${digest.unansweredTotal} still awaiting a public reply
    </p>
    <table style="border-collapse:collapse;width:100%;font-size:14px;">
      <thead>
        <tr style="text-align:left;color:#666;">
          <th style="padding:6px 10px;border-bottom:2px solid #ddd;">Business</th>
          <th style="padding:6px 10px;border-bottom:2px solid #ddd;text-align:center;">New (7 days)</th>
          <th style="padding:6px 10px;border-bottom:2px solid #ddd;text-align:center;">Awaiting reply</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    ${buildLowStarHtml(digest)}
    <p style="margin:20px 0 4px;">
      <a href="${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/dashboard/reputation" style="background:#4f46e5;color:#fff;padding:9px 16px;border-radius:6px;text-decoration:none;font-size:14px;">Open Reputation dashboard</a>
    </p>
    <p style="margin:8px 0 0;color:#888;font-size:12px;">
      Draft replies are waiting on the Reputation dashboard — Lana pre-drafted responses for new low-star reviews.
      Replying to this email adds a private note to the matching review (include the <code>[Re:#…]</code> code shown above).
    </p>
  </div>`;
}

async function sendDigest(recipients: string[], digest: TenantDigest): Promise<boolean> {
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
        subject: `Weekly reputation digest — ${digest.newTotal} new review${digest.newTotal === 1 ? "" : "s"}, ${digest.unansweredTotal} awaiting reply`,
        html: buildDigestHtml(digest),
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      console.error(`[reputationDigest] Resend ${res.status}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[reputationDigest] send failed:", (err as Error).message);
    return false;
  }
}
