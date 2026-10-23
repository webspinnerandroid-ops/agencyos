# IMPLEMENTATION HANDOFF — Plan v3 "Implement in full" (2026-09-11)

All code below is **on disk in agency-os** and passes all three house gates:
`tsc --noEmit` clean · **540/540 vitest** · `next build` succeeds.

Two things the platform already had (discovered mid-implementation, previously
scheduled as Phase 5 work): the **tenant-isolation audit test**
(`scripts/audit-tenant-scope.cjs` + `isolation-audit.test.ts`) and the
**anti-fabrication SEO prompt fix** (`seo-prompts.ts` now mandates labeled
estimates). My new code was held to the audit's standard — the classifier's
queries are tenant-scoped per tenant, not allowlisted.

---

## What was implemented

### Phase 0 — Decisions & catalog
- `docs/phase-0-decisions.md` (in the planning repo) — ADR-001…006.
- `catalog/service.schema.json` + `catalog/seo_campaign.yaml` +
  `catalog/web_build.yaml` — the system's brain, validated by
  `src/lib/agency/catalog.test.ts` in CI.

### Phase 1 — Foundation / repo / backups (code side)
- Repo: agency-os is now a git repo with commits (done outside this session);
  `.gitignore` already quarantines root-level deploy junk, env files, logs.
- `infra/devstack/` — docker-compose (Caddy, Gitea+PG, code-server,
  Infisical+PG+Redis), Caddyfile with forward-auth stubs, `.env.example`.
- `infra/backup/` — `backup.sh` (nightly restic: Supabase pg_dump + volume
  snapshots + offsite + Telegram notify), `restore-check.sh` (monthly
  automated restore drill into scratch Postgres with table assertions),
  `README.md` (setup), `RUNBOOKS.md` (R1–R6 incl. workflow-reconcile-after-restore).

### Phase 2 — Ledger & cost visibility
- `supabase/migrations/106_agency_ops_backbone.sql` — `activity` (append-only
  via DB trigger), `client_subsystems`, `workflow_state`, `approval_receipts`,
  `email_classifications`, `email_rule_feedback`, `machine_api_keys`. All
  tenant-isolation RLS per house template.
- `src/lib/agency/ledger.ts` — the single sanctioned write path; validates
  required fields, fire-and-forget, `recentForClient()` powers context cards.
- Cost caps: the existing `token-billing.ts` gate already blocks pre-spend
  (402-style) — wired into the model-resolution flow rather than duplicated.

### Phase 3 — Telegram approval gates
- `src/lib/agency/workflow.ts` — persist-before-wait state machine,
  `openApprovalGate()` (single-use token, card metadata stored ON the state
  row), `decideApproval()` (receipt-in-Postgres idempotency), `reconcile()`.
- Telegram webhook additions: `/open <client>` (context card: services, SEO
  status, deep links, last-5 ledger), `/approve`, `/reject`, `/costs`, and
  `ap:approve|reject:<token>` inline buttons wired to `decideApproval` +
  `agency/gate.decided` events.
- `src/lib/inngest/functions/reconcileWorkflows.ts` — nightly 03:17 sweep;
  re-presents waiting gates with the SAME token (duplicates structurally
  impossible), flags >14-day-stale gates.

### Phase 4 — Onboarding & money workflow
- `src/lib/agency/events.ts` — typed Inngest events + `assertRecipientAllowlisted()`.
- `src/lib/inngest/functions/onboardClient.ts` — client ensure (match-or-create,
  replay-safe) → subsystem provisioning → **agreement approval gate** →
  allowlist-enforced send via in-house signing (`createSignRequest`) →
  signature wait (30d) → payment wait (45d, self-healing native-state check)
  → `client_active` ledger + Telegram notifications at every transition.
- Emit sites wired: `signing.ts finalizeSignature()` → ledger +
  `agency/contract.signed`; Stripe webhook `invoice.paid` → idempotent
  (event-id probe) ledger row + `agency/invoice.paid`.
- `src/app/api/agency/onboard/route.ts` — session-auth, Zod-validated trigger.

### Phase 6 — Email classification MVP (read-only)
- `src/lib/agency/email-classifier.ts` — rules engine (catalog + built-in
  client-email/domain/newsletter rules), confidence-gated LLM fallback
  (threshold 0.7, Zod-validated, injection-hardened prompt, body-as-data),
  `unsorted`-not-guessed semantics, idempotent persistence.
- `src/lib/inngest/functions/classifyEmails.ts` — runs after `sync-inboxes`
  + 20-min safety net; **per-tenant** client matching (2-account MVP cap).
- `classify-safety.test.ts` — CI import-graph gate: no SMTP/nodemailer/
  outreach/send-capability may ever be reachable from classifier code.
- `email-classifier.test.ts` — rule matching, gating, injection, fallthrough.

### Phase 7 — Machine API + FreeCMS bridge
- `src/lib/agency/api-keys.ts` — `blm_…` keys, HMAC-peppered hash at rest
  (raw shown once), scopes (`read`, `write:clients`, `export`, `workflow`),
  revocable, `last_used_at` stamping.
- Routes: `/api/agency/keys` (list/mint/revoke, admin-gated),
  `/api/agency/clients` (tenant-scoped by the KEY's tenant, 404-not-403),
  `/api/export/seo-tool` (emits the exact `SeoToolExport` schema FreeCMS's
  `mapSeoToolExport` consumes → closes the pipeline to FreeCMS sites).

---

## Punch list — requires your credentials/servers (cannot be done from here)

1. **Apply migration 106** to Supabase (SQL editor or `supabase db push`).
2. **Runbook setup:** provision Netcup devstack from `infra/devstack/`
   (fill `.env`, point DNS); install backup crons per `infra/backup/README.md`;
   verify Supabase PITR status and record it in `docs/backup-and-dr.md` §2.
3. **Rotate secrets:** `GOOGLE_API_KEY` (pasted in chat, Round 19) and the
   VPS password; move machine secrets into Infisical once it's up.
4. **Register the 3 new Inngest functions** — they self-register via
   `/api/inngest` on next deploy; verify all appear in the dashboard.
5. **Set env:** `MACHINE_KEY_PEPPER` (falls back to `AUTH_COOKIE_SECRET`),
   `TELEGRAM_WEBHOOK_SECRET` (recommended), nothing else new is required.
6. **Two-browser isolation smoke** + Telegram `/open`, `/approve`, `/costs`
   smoke after deploy (Round 19 §5 checklist).
7. **Deploy to VPS** using the established deploy pattern; rebuild + smoke.

## Verification checklist (post-deploy)

- [ ] `npm test` — 540 green locally; confirm on VPS build too
- [ ] `/api/export/seo-tool` with a minted key returns items; FreeCMS CLI
      `freecms import` dry-run round-trips a real workspace
- [ ] `/api/agency/onboard` → Telegram approval card → approve → signing
      email → (test-mode) payment → `client_active` ledger row
- [ ] Replay the Stripe `invoice.paid` webhook 3× → exactly one ledger row
- [ ] Kill the app mid-approval → restart → nightly/manual `reconcile()`
      re-presents the card; approving once completes the workflow exactly once
