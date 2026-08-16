#!/usr/bin/env node
/**
 * audit-tenant-scope.cjs
 *
 * Heuristic audit of multi-tenant isolation for service-role data access.
 * Scans src/ for every `.from("<tenant-scoped-table>")` chain in files that
 * use SUPABASE_SERVICE_ROLE_KEY (or createServiceClient) and flags chains
 * that never filter by tenant_id (or, for inserts, never set tenant_id).
 *
 * This is a guard, not a proof: long or unusual chains may slip past the
 * window, and allowlisted files are exempt by design (job workers that
 * legitimately operate across tenants, auth helpers, tenant creation).
 * Treat flags as review candidates — confirm each in code.
 *
 * Usage: node scripts/audit-tenant-scope.cjs [--json]
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "src");

// Tables that carry a tenant_id column and must always be tenant-scoped
// when accessed with a service-role client. (Comments/post_platforms/
// publishing_logs/analytics_snapshots have no tenant_id — scoped via joins.)
const TENANT_TABLES = new Set([
  "tenants", "user_roles", "clients", "tier_templates", "tenant_api_keys",
  "task_model_mappings", "social_accounts", "posts", "site_audits",
  "competitors", "seo_campaigns", "subscriptions", "workspaces",
  "knowledgebase_folders", "knowledgebase_items", "brand_profiles",
  "email_accounts", "calendar_events", "blog_platforms",
  "google_business_profiles", "licenses", "oauth_states", "media_assets",
  "leads", "lead_activities", "sequences", "sequence_enrollments",
  "call_logs", "tenant_usage", "tenant_ai_employees",
  "team_chats", "team_messages", "campaign_plans",
  "campaign_plan_items",
]);

// Files where unscoped service-role access is by design. Each entry is a
// REVIEWED exception — triaged during the Aug 2026 isolation audit:
//  - Inngest job workers iterate all tenants (billing reset, analytics sync)
//    or operate on records already fetched tenant-scoped upstream.
//  - proxy.ts resolves auth context by user_id.
//  - register creates a brand-new tenant.
//  - auth callbacks/set-session do user-scoped lookups.
//  - Stripe/Twilio webhooks authenticate service-to-service (by
//    stripe_subscription_id / twilio_call_sid), not by user session.
//  - admin/actions.ts is super_admin-wide by design.
//  - libs below are called with a tenantId (or after a tenant-scoped fetch)
//    by their callers; the by-id ops are scoped upstream.
//  - client-proposals/public-proposal are scoped by client_id — the client
//    boundary, which is the correct scope for client-facing reads.
const IGNORE = new Set([
  // Inngest job workers
  "src/lib/inngest/functions/monthlyBillingReset.ts",
  "src/lib/inngest/functions/fetchAnalytics.ts",
  "src/lib/inngest/functions/syncInboxes.ts",
  "src/lib/inngest/functions/syncSocialInbox.ts",
  "src/lib/inngest/functions/processSequences.ts",
  "src/lib/inngest/functions/publishScheduledPosts.ts",
  "src/lib/inngest/functions/checkProviderBalances.ts",
  "src/lib/inngest/functions/syncSiteMetrics.ts",
  // Auth plumbing
  "src/proxy.ts",
  "src/app/api/register/route.ts",
  "src/app/api/auth/set-session/route.ts",
  "src/app/api/auth/callback/google/route.ts",
  "src/app/api/auth/callback/meta/route.ts",
  "src/app/api/auth/callback/outlook/route.ts",
  "src/app/api/auth/callback/twitter/route.ts",
  // Service-to-service webhooks
  "src/app/api/webhooks/stripe/route.ts",
  "src/app/api/voice/incoming/respond/route.ts",
  "src/lib/voice/haven.ts",
  // Super-admin wide access
  "src/app/dashboard/admin/actions.ts",
  // apis/route.ts: the APIs & Balances panel is a super-admin-wide view by
  // design — it lists tenant_api_keys counts and balance state across ALL
  // tenants (the same trust model as admin/actions.ts). The admin gate
  // (requireAdmin -> super_admin role) runs first on every request.
  "src/app/api/admin/apis/route.ts",
  // Libs scoped upstream by their callers (tenantId passed in)
  "src/lib/inbox/archer.ts",
  "src/lib/media/flux.ts",
  "src/lib/leads/cipher.ts",
  "src/lib/publishing/wordpressPublisher.ts",
  "src/lib/knowledgebase.ts",
  "src/lib/seo/deployCampaign.ts",
  "src/lib/usage.ts",
  "src/lib/tenant.ts",
  // Callers verify tenant via session before the by-id lookup
  "src/app/api/billing/route.ts",
  "src/app/dashboard/settings/white-label/actions.ts",
  "src/app/dashboard/settings/ai/actions.ts",
  // Client-scoped by design (client boundary, not tenant)
  "src/app/api/seo/client-proposals/route.ts",
  "src/app/api/seo/public-proposal/route.ts",
  // public-audit route: public by design — the share-link UUID is the
  // secret (same trust model as public-proposal). Single-row lookup by
  // unguessable id; the response returns only that row's audit data (url,
  // tier, audit_json) — never a list, never tenant_id/client_id. The audit
  // data itself may contain the tenant's site content by design since the
  // link is only handed to that agency's client.
  "src/app/api/seo/public-audit/[id]/route.ts",
  // approve route: client-path fetch checks client_id immediately after;
  // agency-path fetch goes through tenantScopedClient (runtime-enforced
  // filter the static regex can't see through the proxy). Both verified.
  "src/app/api/seo/campaigns/[id]/approve/route.ts",
  // The helper itself — its "flagged" chains are docstring examples.
  "src/lib/supabase/tenant-scope.ts",
  // ai-team.ts: all tenant_ai_employees access goes through
  // tenantScopedClient (runtime-enforced tenant filter + insert payload
  // forcing — invisible to the static regex). The ai_employees catalog is
  // global and intentionally unscoped. Verified.
  "src/lib/ai-team.ts",
  // ai-team-chat.ts: all team_chats/team_messages/tenant_ai_employees
  // access goes through tenantScopedClient (runtime-enforced tenant filter
  // + insert payload forcing — invisible to the static regex) plus
  // assertTenantOwner on by-id chat lookups. The ai_employees catalog
  // query is global and intentionally unscoped. Verified.
  "src/lib/ai-team-chat.ts",
  // ai/team-task.ts: the Inngest background pipeline for chat tasks. Same
  // verified pattern as ai-team-chat.ts — every team_chats/team_messages/
  // tenant_ai_employees access goes through tenantScopedClient (runtime
  // tenant filter + insert forcing) with assertTenantOwner on by-id chat
  // lookups; tenantId is passed explicitly in the task payload. The
  // ai_employees catalog query is global and intentionally unscoped.
  // Verified.
  "src/lib/ai/team-task.ts",
  // campaign-plans.ts: all campaign_plans/campaign_plan_items access goes
  // through tenantScopedClient (runtime tenant filter + insert forcing,
  // invisible to the static regex); tenantId is passed explicitly by the
  // caller (worker / API route, both session-authenticated). Verified.
  "src/lib/campaign-plans.ts",
  // campaign docusign route: agency-path fetch + update go through
  // tenantScopedClient (runtime-enforced tenant filter invisible to the
  // static regex) plus assertTenantOwner on the by-id lookup. Same verified
  // pattern as the approve route above.
  "src/app/api/seo/campaigns/[id]/docusign/route.ts",
  // campaign sign-request route: same verified pattern as the docusign
  // route — fetch + update go through tenantScopedClient (runtime tenant
  // filter invisible to the static regex) plus assertTenantOwner on the
  // by-id lookup.
  "src/app/api/seo/campaigns/[id]/sign-request/route.ts",
  // signing.ts (in-house e-signature): the campaign lookups by id here are
  // scoped upstream by callers — the agency route fetches through
  // tenantScopedClient + assertTenantOwner before calling createSignRequest,
  // and the public sign page/routes are gated by the unguessable sign token
  // (same trust model as the docusign Connect webhook: the token is the
  // secret, and every write is keyed to the row's own id, never an
  // attacker-supplied tenant_id). The finalize write mirrors exactly what the
  // allowlisted docusign webhook did.
  "src/lib/signing.ts",
  // campaign re-run-audit route: same verified pattern — fetch + update go
  // through tenantScopedClient (runtime tenant filter invisible to the static
  // regex) plus assertTenantOwner on the by-id lookup. The rescore helper it
  // calls is pure (no DB access); the client's own audit_json is untouched.
  "src/app/api/seo/campaigns/[id]/re-run-audit/route.ts",
  // public-proposal sign route: public by design, gated by the clientId
  // share-link secret (same trust model as the allowlisted public-proposal
  // route) — every operation verifies campaign.client_id === clientId
  // before touching the row.
  "src/app/api/seo/public-proposal/[campaignId]/sign/route.ts",
  // docusign Connect webhook: public by design, no tenant session. Envelopes
  // are looked up by the DocuSign envelope id (a cryptographic random known
  // only to DocuSign + the agency that created it) and all writes are keyed
  // by that row's id — the row's own tenant_id is never attacker-supplied.
  "src/app/api/docusign/connect/route.ts",
  // competitor-backfill.ts: cross-tenant maintenance worker (scheduled Inngest
  // job + one-off script) that scores every tenant's stored competitor URLs
  // with the service role. It only ever writes competitors_json back to the
  // same seo_campaigns row it read (keyed by the row's own id, never a
  // tenant-supplied value) and is never reachable from a user session.
  "src/lib/seo/competitor-backfill.ts",
  // refreshCompetitorBenchmarks.ts: monthly maintenance job, same class as
  // competitor-backfill.ts — re-scores every tenant's stored competitors with
  // the service role and writes competitors_json back only to the row it read
  // (keyed by the row's own id). Never reachable from a user session.
  "src/lib/inngest/functions/refreshCompetitorBenchmarks.ts",
  // autoAuditMonitoredSites.ts: weekly cross-tenant maintenance job, same
  // class as refreshCompetitorBenchmarks — re-runs the SEO/AEO/GEO analyzer
  // on every tenant's monitored site_audits URLs with the service role. It
  // only inserts a new site_audits row carrying the same tenant_id it read
  // (never a tenant-supplied value) and is never reachable from a user
  // session. Verified.
  "src/lib/inngest/functions/autoAuditMonitoredSites.ts",
  // auth/dev-login route: DEV-ONLY (404s unless ALLOW_DEV_LOGIN=true, which
  // is only set in local .env.local) — checks one hard-coded owner account's
  // super_admin role by user_id to mint a magic-link token. Single-row role
  // check on a known account, never reachable in production. Verified.
  "src/app/api/auth/dev-login/route.ts",
]);

const CHAIN_WINDOW = 900; // chars after .from(...) — enough for chained filters

// Find the end of a `.from(...) ... .method(...)` chain by tracking paren
// balance: whenever depth returns to 0 the current method call is complete,
// and if the next non-whitespace char is not ".", the chain has ended.
// This works for semicolon-less files where `;`-delimiting would bleed into
// the next statement (e.g. a following .insert() on a different table).
function chainWindow(src, start) {
  let depth = 0;
  let i = start;
  for (; i < src.length && i - start < CHAIN_WINDOW; i++) {
    const c = src[i];
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) {
        let j = i + 1;
        while (j < src.length && /\s/.test(src[j])) j++;
        if (src[j] !== ".") return src.slice(start, j);
        i = j; // continue from the next dot (loop i++ lands on it)
      }
    }
  }
  return src.slice(start, i);
}

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

const fromRe = /\.from\(\s*["'`]([a-z_]+)["'`]\s*\)/g;

function audit() {
  const flagged = [];
  for (const file of walk(SRC)) {
    const rel = path.relative(ROOT, file).replace(/\\/g, "/");
    if (rel.includes(".test.")) continue;
    const src = fs.readFileSync(file, "utf-8");
    if (!src.includes("SUPABASE_SERVICE_ROLE_KEY") && !src.includes("createServiceClient")) continue;

    fromRe.lastIndex = 0;
    let m;
    while ((m = fromRe.exec(src))) {
      const table = m[1];
      if (!TENANT_TABLES.has(table)) continue;

      const window = chainWindow(src, m.index);
      const hasInsert = /\.(?:insert|upsert)\(/.test(window.slice(0, 400));
      const hasEqFilter = /\.eq\(\s*["'`]tenant_id["'`]/.test(window);
      const hasPayloadTenant = /tenant_id\s*:/.test(window.slice(0, 400));

      // Scope rules:
      //  - .insert()/.upsert() must set tenant_id in the payload.
      //  - .update()/.delete() and reads must filter via .eq("tenant_id", ...)
      //    (an update payload setting tenant_id would write it to ALL rows —
      //    that is not scoping, so it is never accepted for writes).
      const scoped = hasInsert ? hasPayloadTenant : hasEqFilter;
      if (!scoped && !IGNORE.has(rel)) {
        flagged.push({
          file: rel,
          table,
          snippet: window.slice(0, 160).replace(/\s+/g, " ").trim(),
        });
      }
    }
  }
  return flagged;
}

const flagged = audit();
if (process.argv.includes("--json")) {
  console.log(JSON.stringify(flagged, null, 2));
} else {
  console.log(`Service-role queries on tenant tables WITHOUT tenant scope: ${flagged.length}`);
  for (const f of flagged) {
    console.log(`- ${f.file} :: ${f.table} :: ${f.snippet}...`);
  }
}
process.exit(flagged.length > 0 ? 1 : 0);
