-- 070 — per-workspace connections
-- A tenant with multiple client workspaces can now connect different Google
-- accounts / GA4 properties / Search Console sites per workspace, instead of
-- one tenant-wide Google connection shared by every client.
--
-- Legacy rows keep workspace_id = NULL and remain visible as a fallback in
-- every workspace until the owner reconnects per workspace (reads prefer the
-- workspace-scoped row when one exists).

ALTER TABLE tenant_connections
    ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces (id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_tenant_connections_workspace
    ON tenant_connections (workspace_id);

-- Replace the old (tenant_id, provider) uniqueness with a per-workspace key.
-- Postgres treats NULLs as distinct in unique indexes, so legacy NULL rows can
-- coexist with workspace-scoped rows; new connects always carry a workspace id.
ALTER TABLE tenant_connections
    DROP CONSTRAINT IF EXISTS tenant_connections_tenant_id_provider_key;
CREATE UNIQUE INDEX IF NOT EXISTS tenant_connections_tenant_workspace_provider_key
    ON tenant_connections (tenant_id, workspace_id, provider);

-- OAuth state carries the workspace so the callback after the Google consent
-- round-trip assigns the connection to the right workspace.
ALTER TABLE oauth_states
    ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces (id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_oauth_states_workspace ON oauth_states (workspace_id);
