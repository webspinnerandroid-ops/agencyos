-- ============================================================================
-- 106 — Agency ops backbone: activity ledger, client↔subsystem map,
--       durable workflow state, approval receipts, email classifications.
--
-- Design (docs/phase-0-decisions.md ADR-003, docs/backup-and-dr.md §4):
--   * Inngest is the scheduler/messenger; Postgres (these tables) is the
--     durable source of truth. Approval receipts land here BEFORE resume.
--   * The activity ledger is append-only evidence: DB trigger + separate
--     restricted role deny UPDATE/DELETE for the app user (docs/backup-and-dr.md §5).
--   * All tables carry tenant_id + tenant_isolation RLS per the house
--     template (ARCHITECTURE.md). client_onboarding-style service-only
--     tables (approval_receipts) enable RLS with no policies.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 106.1 — activity ledger (append-only)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS activity (
  id           BIGSERIAL PRIMARY KEY,
  tenant_id    UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES workspaces (id) ON DELETE SET NULL,
  client_id    UUID REFERENCES clients (id) ON DELETE SET NULL,
  actor        TEXT NOT NULL DEFAULT 'system',      -- 'system', user_id, 'telegram:<chat>', 'api:<keyid>'
  type         TEXT NOT NULL,                       -- 'email','seo','payment','workflow','approval','issue',...
  source       TEXT NOT NULL DEFAULT 'app',         -- 'app','telegram','api','inngest','webhook'
  summary      TEXT NOT NULL,
  payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
  artifact_ref TEXT,
  status       TEXT NOT NULL DEFAULT 'ok',          -- 'ok','pending','failed','waiting_for_approval'
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_tenant_time ON activity (tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_client_time ON activity (client_id, occurred_at DESC) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_activity_type ON activity (tenant_id, type);

ALTER TABLE activity ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "tenant_isolation" ON activity
    FOR ALL USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Append-only: the app must never rewrite history. Updates/deletes via the
-- anon/authenticated roles are blocked by RLS already (no WRITE policy grant
-- beyond tenant_isolation FOR ALL — belt) — and this trigger is braces:
-- even the service role path goes through ledger_client which only inserts.
CREATE OR REPLACE FUNCTION activity_block_rewrite() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'activity ledger is append-only: % blocked', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS activity_no_update ON activity;
CREATE TRIGGER activity_no_update
  BEFORE UPDATE OR DELETE ON activity
  FOR EACH ROW EXECUTE FUNCTION activity_block_rewrite();

-- ---------------------------------------------------------------------------
-- 106.2 — client ↔ subsystem mapping ("Open Acme" in one query)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS client_subsystems (
  client_id      UUID NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  tenant_id      UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  subsystem      TEXT NOT NULL,                     -- 'agency_os_seo','freecms_repo','stripe','docusign'
  resource_id    TEXT,
  resource_url   TEXT,
  credential_ref TEXT,                              -- Infisical path; NEVER the secret itself
  provisioned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata       JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (client_id, subsystem)
);

CREATE INDEX IF NOT EXISTS idx_client_subsystems_tenant ON client_subsystems (tenant_id);

ALTER TABLE client_subsystems ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "tenant_isolation" ON client_subsystems
    FOR ALL USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- 106.3 — durable workflow state (Postgres = source of truth, Inngest = runner)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workflow_state (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  workflow        TEXT NOT NULL,                    -- 'onboard_client', ...
  step            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','waiting_for_approval','running','done','failed','rejected','cancelled')),
  idempotency_key TEXT NOT NULL UNIQUE,
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  approval_token  TEXT UNIQUE,
  result          JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_state_open
  ON workflow_state (status, updated_at)
  WHERE status IN ('pending','waiting_for_approval','running');

ALTER TABLE workflow_state ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "tenant_isolation" ON workflow_state
    FOR ALL USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- 106.4 — approval receipts (service-role only; RLS with no policies,
--          same pattern as client_onboarding / token_ledger)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS approval_receipts (
  id             BIGSERIAL PRIMARY KEY,
  state_id       UUID NOT NULL REFERENCES workflow_state (id) ON DELETE CASCADE,
  tenant_id      UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  decision       TEXT NOT NULL CHECK (decision IN ('approved','rejected')),
  decided_by     TEXT NOT NULL,                     -- user_id or 'telegram:<chat_id>'
  channel        TEXT NOT NULL DEFAULT 'telegram',
  telegram_message_id BIGINT,
  decided_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE approval_receipts ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 106.5 — email classifications (Phase 6 MVP — rules-first, read-only module)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_classifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  account_id    TEXT NOT NULL,
  message_id    TEXT NOT NULL,
  thread_id     TEXT,
  client_id     UUID REFERENCES clients (id) ON DELETE SET NULL,
  category      TEXT NOT NULL
                CHECK (category IN ('client','lead','billing','issue','newsletter','spam','other','unsorted')),
  method        TEXT NOT NULL,                      -- 'rule:<name>' or 'llm'
  confidence    NUMERIC(4,3) NOT NULL,
  evidence      JSONB NOT NULL DEFAULT '{}'::jsonb, -- which rule fired / LLM rationale
  classified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, account_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_email_class_tenant_unsorted
  ON email_classifications (tenant_id, category)
  WHERE category = 'unsorted';

ALTER TABLE email_classifications ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "tenant_isolation" ON email_classifications
    FOR ALL USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Manual triage corrections (the accuracy engine — feeds future rule seeding)
CREATE TABLE IF NOT EXISTS email_rule_feedback (
  id            BIGSERIAL PRIMARY KEY,
  tenant_id     UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  message_id    TEXT NOT NULL,
  account_id    TEXT NOT NULL,
  corrected_client_id UUID REFERENCES clients (id) ON DELETE SET NULL,
  corrected_category  TEXT,
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE email_rule_feedback ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "tenant_isolation" ON email_rule_feedback
    FOR ALL USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- 106.6 — machine API keys (Phase 7: scoped, revocable, hashed at rest)
--           RLS with no policies — service-role only, like approval_receipts.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS machine_api_keys (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  key_hash    TEXT NOT NULL UNIQUE,               -- HMAC-SHA256 hex of the raw key
  scopes      TEXT[] NOT NULL DEFAULT '{read}',   -- 'read','write:clients','export'
  created_by  TEXT,
  last_used_at TIMESTAMPTZ,
  revoked_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE machine_api_keys ENABLE ROW LEVEL SECURITY;
