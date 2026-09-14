-- ============================================================================
-- smoke-test-seed.sql — end-to-end smoke data for the agency-ops workflow.
--
-- ⚠️ Deliberately NOT in supabase/migrations/ (never auto-applied).
--    Run manually in the Supabase SQL editor AFTER migration 106.
--
-- Creates a fully isolated "Smoke Test Tenant" with deterministic UUIDs so
-- it's idempotent (re-running is a no-op). Cleanup at the bottom CASCADEs
-- everything away via the single DELETE on tenants.
--
-- Nothing here touches your real tenants/clients — everything hangs off
-- :smoke_tenant, and every INSERT is guarded by ON CONFLICT DO NOTHING.
-- ============================================================================

BEGIN;

-- Deterministic IDs — change these only if they collide with real rows.
\set smoke_tenant '00000000-0000-0000-0000-00000000aa01'
\set smoke_workspace '00000000-0000-0000-0000-00000000aa02'
\set smoke_client '00000000-0000-0000-0000-00000000aa03'

-- ---------------------------------------------------------------------------
-- 1. Tenant (isolation boundary for everything below)
-- ---------------------------------------------------------------------------
INSERT INTO tenants (id, name, slug, billing_email)
VALUES (:'smoke_tenant', 'Smoke Test Tenant', 'smoke-test-tenant', 'smoke@blissmedialab.com')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Default workspace (the onboard workflow provisions into this)
-- ---------------------------------------------------------------------------
INSERT INTO workspaces (id, tenant_id, name, slug, description, is_default)
VALUES (:'smoke_workspace', :'smoke_tenant', 'Smoke Workspace', 'smoke-workspace',
        'Created by smoke-test-seed', true)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Client the workflow will operate on
--    (name intentionally test-obvious; the workflow match-or-creates on name)
-- ---------------------------------------------------------------------------
INSERT INTO clients (id, tenant_id, workspace_id, name, website, email)
VALUES (:'smoke_client', :'smoke_tenant', :'smoke_workspace',
        'SMOKE Acme Rentals', 'https://smoke-acmerentals.example', 'smoke-acme@example.com')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. Client ↔ subsystem mapping (what /open renders and the machine API reads)
-- ---------------------------------------------------------------------------
INSERT INTO client_subsystems (client_id, tenant_id, subsystem, resource_id, resource_url, metadata)
VALUES
  (:'smoke_client', :'smoke_tenant', 'agency_os_workspace', :'smoke_workspace', NULL,
   '{"source":"smoke-test-seed"}'::jsonb),
  (:'smoke_client', :'smoke_tenant', 'agency_os_seo', :'smoke_client', NULL,
   '{"source":"smoke-test-seed"}'::jsonb)
ON CONFLICT (client_id, subsystem) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 5. One seeded ledger row (proves /open has something to show)
-- ---------------------------------------------------------------------------
INSERT INTO activity (tenant_id, workspace_id, client_id, actor, type, source, summary, payload, artifact_ref, status)
VALUES (:'smoke_tenant', :'smoke_workspace', :'smoke_client', 'system', 'client', 'app',
        'Smoke test client seeded', '{"seeded_by":"smoke-test-seed.sql"}'::jsonb,
        :'smoke_client', 'ok')
ON CONFLICT DO NOTHING;

-- If the ledger trigger blocks re-runs (it does — append-only), the line
-- above is a no-op only the FIRST time; later runs raise. That's fine:
-- run this file once, and if you need a fresh row use the cleanup below.

COMMIT;

-- ============================================================================
-- SMOKE TEST — run these checks in order (SQL editor):
-- ============================================================================
-- ✅ 1. Tables exist (7 rows):
--      SELECT table_name FROM information_schema.tables
--      WHERE table_schema='public' AND table_name IN
--        ('activity','client_subsystems','workflow_state','approval_receipts',
--         'email_classifications','email_rule_feedback','machine_api_keys');
--
-- ✅ 2. Ledger is append-only (this MUST error):
--      UPDATE activity SET summary='tampered' WHERE type='client';
--      -- expected: ERROR: activity ledger is append-only: UPDATE blocked
--
-- ✅ 3. Machine API key round-trip (run AFTER deploying the app):
--      - Log into the app as super_admin → mint a key:
--        curl -X POST <site>/api/agency/keys -H 'Cookie: <your-session>' \
--             -H 'Content-Type: application/json' \
--             -d '{"name":"smoke-test","scopes":["read","export"]}'
--      - List clients with it:
--        curl <site>/api/agency/clients -H 'Authorization: Bearer blm_...'
--        → should return ONLY "SMOKE Acme Rentals" (the key's tenant scope)
--
-- ✅ 4. Telegram smoke (bot configured): /open SMOKE → context card with the
--      seeded ledger row; /costs → balance or "not enforced" message.
--
-- ============================================================================
-- CLEANUP — deletes the tenant and CASCADEs every seeded row away:
-- ============================================================================
-- DELETE FROM tenants WHERE id = '00000000-0000-0000-0000-00000000aa01';
-- (clients, workspaces, client_subsystems, activity, workflow_state and
--  approval_receipts rows all die via ON DELETE CASCADE.
--  NOTE: activity rows created AFTER seeding can't be deleted through the
--  app role — use the SQL editor, which runs as postgres.)
