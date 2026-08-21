-- ============================================================================
-- 093 — client onboarding lifecycle
--
-- The single state machine shared by the onboarding wizard AND Malory's
-- conversational onboarding. One row per client; `step` is a 0-based index
-- into the wizard's step list (client_workspace → connections → brand_profile
-- → content_plan → publish_targets → go_live). The wizard owns the state;
-- chat completions write through the same rows via src/lib/client-lifecycle.ts.
--
-- RLS is enabled with NO policies: the table is only reachable through the
-- service-role client (same pattern as token_ledger / tenant_balances), so
-- tenant scoping is enforced by the app layer (.eq("tenant_id", ...)) and no
-- client/anon principal can read another tenant's onboarding data.
-- ============================================================================

CREATE TABLE IF NOT EXISTS client_onboarding (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    client_id    UUID NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
    workspace_id UUID REFERENCES workspaces (id) ON DELETE SET NULL,
    step         INTEGER NOT NULL DEFAULT 0 CHECK (step BETWEEN 0 AND 5),
    status       TEXT NOT NULL DEFAULT 'not_started'
                 CHECK (status IN ('not_started', 'in_progress', 'completed')),
    data         JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, client_id)
);

CREATE INDEX IF NOT EXISTS idx_client_onboarding_tenant ON client_onboarding (tenant_id);
CREATE INDEX IF NOT EXISTS idx_client_onboarding_client ON client_onboarding (client_id);
CREATE INDEX IF NOT EXISTS idx_client_onboarding_workspace ON client_onboarding (workspace_id);

ALTER TABLE client_onboarding ENABLE ROW LEVEL SECURITY;
