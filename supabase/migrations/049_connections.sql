-- 049 — per-tenant Google Analytics 4 / Search Console connections
-- Stores OAuth tokens encrypted at rest (AES via ENCRYPTION_KEY) plus the
-- resource the tenant chose to track (GA4 property id / SC site URL).

CREATE TABLE IF NOT EXISTS tenant_connections (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    provider          TEXT NOT NULL CHECK (provider IN ('google_analytics', 'search_console')),
    account_email     TEXT,
    account_name      TEXT,
    encrypted_token   TEXT NOT NULL,
    scopes            TEXT,
    selected_resource TEXT,
    resource_label    TEXT,
    connected         BOOLEAN NOT NULL DEFAULT true,
    last_synced_at    TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_tenant_connections_tenant ON tenant_connections (tenant_id);
ALTER TABLE tenant_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "no_direct_access" ON tenant_connections FOR ALL USING (false);
