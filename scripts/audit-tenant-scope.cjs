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
 * Two kinds of exemption, deliberately different in blast radius:
 *   IGNORE   — whole file is cross-tenant by design (job workers, webhooks).
 *   REVIEWED — one `<file>::<table>` pair, with the reason it is safe. The rest
 *              of that file (and every other query in it) stays audited.
 * Anything neither scoped nor exempt fails the run (exit 1) — this is a CI
 * gate, see .github/workflows/ci.yml.
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

  // Tables added by later migrations (100+) that carry tenant_id. They were
  // missing from this list, which meant the gate silently did not cover the
  // newest — and least reviewed — code in the repo.
  "activity", "approval_receipts", "client_subsystems", "workflow_state",
  "email_classifications", "email_rule_feedback", "machine_api_keys",
  "content_map_items", "content_map_imports", "content_opportunities",
  "asset_folders", "cms_form_submissions", "cms_site_settings", "nav_config",
  "notifications", "gbp_alert_webhooks", "gbp_reviews", "gbp_sync_state",
  "keyword_rankings", "license_audit_log", "make_relay_client_overrides",
  "make_relay_config", "outreach_targets", "sign_requests", "site_domains",
  "site_pages", "site_settings", "tenant_balances", "tenant_connections",
  "tenant_settings", "token_ledger", "traffic_snapshots", "workspace_members",
  "client_onboarding",
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
  "src/lib/inngest/functions/classifyEmails.ts",
  "src/lib/inngest/functions/syncSocialInbox.ts",
  "src/lib/inngest/functions/processSequences.ts",
  "src/lib/inngest/functions/publishScheduledPosts.ts",
  "src/lib/inngest/functions/checkProviderBalances.ts",
  "src/lib/inngest/functions/syncSiteMetrics.ts",
  "src/lib/inngest/functions/syncGbpReviews.ts",
  "src/lib/inngest/functions/reputationDigestEmail.ts",
  // Auth plumbing
  "src/proxy.ts",
  "src/app/api/register/route.ts",
  "src/app/api/auth/set-session/route.ts",
  "src/app/api/auth/callback/google/route.ts",
  "src/app/api/auth/callback/meta/route.ts",
  "src/app/api/auth/callback/outlook/route.ts",
  "src/app/api/auth/callback/twitter/route.ts",
  // session route: resolves the CALLER's own role by their authenticated
  // user_id (never an arbitrary user, never tenant data) so client components
  // can gate super-admin-only options. Same trust class as the callbacks.
  "src/app/api/auth/session/route.ts",
  // Service-to-service webhooks
  "src/app/api/webhooks/stripe/route.ts",
  "src/app/api/voice/incoming/respond/route.ts",
  "src/lib/voice/haven.ts",
  // Super-admin wide access
  "src/app/dashboard/admin/actions.ts",
  // data-deletion route: public request intake (no session). It writes the
  // request into admin_audit_log and reads user_roles to find ALL super
  // admins to notify — a cross-tenant read by design (same trust class as
  // admin/actions.ts). It never returns tenant data to the caller; the
  // response is a fixed confirmation string.
  "src/app/api/data-deletion/route.ts",
  // export-data route: public GDPR intake (no session). It looks up the
  // account by the submitted email, then reads ONLY that user's own roles
  // (by user_id) and the tenants they belong to (by id) to build their JSON
  // archive. The archive is emailed to that same address — nothing is
  // returned to the caller. Same trust class as the data-deletion route.
  "src/app/api/export-data/route.ts",
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
  "src/app/api/billing/topup/route.ts",
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
  // content-map-autopublish.ts: the 15-minute auto-publish hold processor.
  // A cross-tenant job worker by design — it sweeps EVERY tenant's expired
  // holds on a timer (the exact same trust model as the allowlisted
  // publishScheduledPosts.ts above it: background scheduler, no session,
  // tenant_id carried from the scanned row into every subsequent write).
  // Each due post is claimed by clearing its own auto_publish_at keyed to
  // the row id + the expiry predicate, never an attacker-supplied tenant.
  "src/lib/content-map-autopublish.ts",
  // retryFailedPublishes.ts: the publish-retry sweeper (5m/30m/2h backoff
  // ladder for failed publishes). Cross-tenant job worker, same trust model
  // as publishScheduledPosts.ts + content-map-autopublish.ts above: it
  // sweeps every tenant's failed posts on a schedule; each due post is
  // claimed (retry marker bumped) keyed to the row id + status predicate
  // before any publish runs, and tenant_id flows from the scanned row into
  // every write and notification.
  "src/lib/publishing/retryFailedPublishes.ts",
  // grouped-notifications.ts: folds per-post publish events into one bell
  // row per client — a support module for the allowlisted sweepers above.
  // The only cross-tenant read is the client NAME lookup by the client_id
  // carried on the scanned post row (no user input, no writes to clients);
  // notification inserts carry the scanned row's tenant_id verbatim.
  "src/lib/publishing/grouped-notifications.ts",
  // publishingHealthWeeklyEmail.ts: the weekly per-tenant publishing-health
  // digest. Cross-tenant like the reputation digest above it — it sweeps
  // every tenant with recent post activity, reads only that tenant's rows
  // (every query carries the scanned tenant_id), and resolves recipients
  // from the tenant's own user_roles. No attacker-supplied ids anywhere.
  "src/lib/inngest/functions/publishingHealthWeeklyEmail.ts",
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
  // assetHealthWeeklyEmail.ts: weekly cross-tenant maintenance job, same
  // class as autoAuditMonitoredSites — runs the asset smoke test with the
  // service role and emails the summary to super admins. It reads user_roles
  // only to resolve the recipient list and never writes anything; never
  // reachable from a user session. Verified.
  "src/lib/inngest/functions/assetHealthWeeklyEmail.ts",
  // auth/dev-login route: DEV-ONLY (404s unless ALLOW_DEV_LOGIN=true, which
  // is only set in local .env.local) — checks one hard-coded owner account's
  // super_admin role by user_id to mint a magic-link token. Single-row role
  // check on a known account, never reachable in production. Verified.
  "src/app/api/auth/dev-login/route.ts",
  // tenant/admin-access route: reads/writes the CALLER'S OWN tenant row
  // (tenants) by primary key id — the id comes from the session's tenant,
  // never from the client, so it can only ever touch the caller's own row.
  // Reviewed and verified.
  "src/app/api/tenant/admin-access/route.ts",
  // admin/login-as route: SUPER_ADMIN ONLY (requireRole) — reads one tenant
  // row by PK to check the opt-in flag, then mints a magic link for that
  // tenant's owner. Global admin tool, same trust class as the other
  // admin/* routes. Reviewed and verified.
  "src/app/api/admin/login-as/route.ts",
  // workspace-team.ts: inviteTeamMember performs an admin-wide cross-tenant
  // user_roles lookup by primary key (user_id) to refuse moving a user who
  // already belongs to another team. SUPER_ADMIN / AGENCY_ADMIN only — same
  // trust class as admin/actions.ts. Verified.
  "src/lib/workspace-team.ts",
]);

// ---------------------------------------------------------------------------
// Reviewed exceptions, keyed `<file>::<table>`.
//
// This is stricter than IGNORE: the file keeps being audited, only the specific
// table inside it is exempt. Every entry was read in code (Oct 2026 sweep) and
// the reason records WHY the heuristic cannot see the scoping. Anything not
// listed here still fails the gate, including new queries in these files.
// ---------------------------------------------------------------------------
const REVIEWED = new Map([
  // ---- platform singletons: one global row (id = 1), no tenant dimension ----
  ["src/app/api/admin/page-builder/pricing/route.ts::site_settings",
    "platform pricing row id=1; super_admin only (page-builder admin)"],
  ["src/app/api/admin/page-builder/route.ts::site_settings",
    "platform landing row id=1; super_admin only"],
  ["src/app/dashboard/settings/actions.ts::site_settings",
    "platform hero row id=1; requireSuperAdmin() before every read/write"],
  ["src/app/page.tsx::site_settings",
    "public marketing page reads the platform row id=1"],
  ["src/lib/landing-content-server.ts::site_settings",
    "server-side read of the platform landing row id=1"],

  // ---- updates/deletes by a row id that came from a tenant-scoped read ----
  ["src/app/api/analytics/route.ts::tenant_connections",
    "conn resolved by .eq(tenant_id) a few lines above; the write is keyed by conn.id"],
  ["src/app/api/media-assets/[id]/drive/route.ts::tenant_connections",
    "conn resolved by .eq(tenant_id) above; write keyed by conn.id"],
  ["src/app/api/seo/rankings/route.ts::tenant_connections",
    "conn resolved by .eq(tenant_id) above; write keyed by conn.id"],
  ["src/app/dashboard/connections/actions.ts::tenant_connections",
    "getConnection(tenantId) / scoped list feeds every write, keyed by conn.id"],
  ["src/lib/drive-sync.ts::tenant_connections",
    "conn loaded per tenant; token refreshes write back to that same row id"],
  ["src/lib/content-map-batch.ts::content_map_items",
    "ids come from a .eq(tenant_id) select in the same function before .in(id, ids)"],
  ["src/lib/workspace.ts::workspace_members",
    "filtered by workspace_id, and the workspace is resolved for the caller's tenant"],

  // ---- payloads the scanner cannot read (variable, not an inline literal) ----
  ["src/app/api/publish/route.ts::site_pages",
    "patch object carries tenant_id/workspace_id/client_id; update also re-filters"],
  ["src/app/api/cms/settings/route.ts::cms_site_settings",
    "record carries tenant_id + workspace_id; update keyed by the scoped row's id"],
  ["src/app/api/analytics/sync/route.ts::traffic_snapshots",
    "rows are mapped with tenant_id from the session; upsert conflicts on it"],
  ["src/app/api/analytics/sync/route.ts::tenant_connections",
    "conn resolved by .eq(tenant_id) above; write keyed by conn.id"],
  ["src/lib/ai/orchestrator.ts::token_ledger",
    "ledger rows are built with tenant_id (metering must record who spent what)"],
  ["src/lib/nav-config.ts::nav_config",
    "select filters tenant_id; the record payload carries tenant_id"],

  // ---- capability tokens: the row id/token is the credential ----
  ["src/app/api/gbp/digest-reply/route.ts::gbp_reviews",
    "[Re:#<id8>] token from the signed digest; ambiguous prefixes are refused"],
  ["src/app/api/outreach/reply-webhook/route.ts::outreach_targets",
    "unguessable target UUID + optional OUTREACH_WEBHOOK_SECRET header"],
  ["src/lib/agency/api-keys.ts::machine_api_keys",
    "lookup by key_hash (the bearer credential); inserts set tenant_id"],
  ["src/lib/agency/workflow.ts::workflow_state",
    "idempotency key / approval token capabilities; the escalation sweep is cross-tenant by design"],
  ["src/lib/agency/workflow.ts::approval_receipts",
    "receipts keyed by the state id resolved from an approval token"],
  ["src/lib/inngest/functions/onboardClient.ts::sign_requests",
    "lookup by the signing token (capability), not by tenant"],
  ["src/lib/inngest/functions/onboardClient.ts::workflow_state",
    "workflow row keyed by its own id/idempotency key; tenant set at insert"],

  // ---- public-by-design surfaces ----
  ["src/app/site/[slug]/page.tsx::site_pages",
    "public site page by slug; drafts require the preview token"],
  ["src/app/api/cms/forms/route.ts::site_pages",
    "public form widget: tenant is derived from the page row, never from the caller"],
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
  let scopedCount = 0;
  let reviewedCount = 0;
  let ignoredFilesCount = 0;
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
      if (scoped) {
        scopedCount++;
      } else if (IGNORE.has(rel)) {
        ignoredFilesCount++;
      } else if (REVIEWED.has(`${rel}::${table}`)) {
        reviewedCount++;
      } else {
        flagged.push({
          file: rel,
          table,
          snippet: window.slice(0, 160).replace(/\s+/g, " ").trim(),
        });
      }
    }
  }
  return { flagged, scopedCount, reviewedCount, ignoredFilesCount };
}

const { flagged, scopedCount, reviewedCount, ignoredFilesCount } = audit();
if (process.argv.includes("--json")) {
  console.log(JSON.stringify(flagged, null, 2));
} else {
  console.log(
    `Tenant-scope audit — scoped: ${scopedCount} · reviewed: ${reviewedCount} · cross-tenant files (allowlisted): ${ignoredFilesCount} · unscoped: ${flagged.length}`
  );
  for (const f of flagged) {
    console.log(`- ${f.file} :: ${f.table} :: ${f.snippet}...`);
  }
  if (flagged.length > 0) {
    console.log(
      "\nFix the query (add .eq(\"tenant_id\", tenantId) or set tenant_id on the payload), " +
        "or add a reviewed exception with a reason if the scoping is real but invisible to this scan."
    );
  }
}
process.exit(flagged.length > 0 ? 1 : 0);
