-- ============================================================================
-- Migration: 008_oauth_states
-- Description: Table for storing pending OAuth state tokens during social login flows
-- ============================================================================

CREATE TABLE IF NOT EXISTS oauth_states (
    id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id       UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    state           TEXT NOT NULL,
    platform        TEXT NOT NULL,
    code_verifier   TEXT,
    expires_at      TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oauth_states_state ON oauth_states (state);
CREATE INDEX IF NOT EXISTS idx_oauth_states_tenant ON oauth_states (tenant_id);

ALTER TABLE oauth_states ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY "tenant_isolation" ON oauth_states
        FOR ALL USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;