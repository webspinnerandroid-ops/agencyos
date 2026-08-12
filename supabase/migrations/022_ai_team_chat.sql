-- ============================================================================
-- Migration: 022_ai_team_chat
-- Description:
--   The AI Team chat. A chat instance per team × workspace × client (the
--   "Team Room" where Malory dispatches) plus per-employee DMs. Messages carry
--   an author (employee_key) so the UI can show visible sender handoffs
--   (Malory → Pam → Cheryl) and deep links to generated work.
--
--   All server access goes through the enforced tenantScopedClient (which
--   forces tenant_id), and RLS below is defense-in-depth for anon/auth keys.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. team_chats — one room per (tenant, workspace, client, kind[, employee])
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS team_chats (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    workspace_id UUID REFERENCES workspaces (id) ON DELETE CASCADE,   -- nullable = all workspaces
    client_id    UUID REFERENCES clients (id) ON DELETE CASCADE,      -- nullable = all clients
    title        TEXT NOT NULL DEFAULT 'Team Chat',
    kind         TEXT NOT NULL DEFAULT 'team' CHECK (kind IN ('team', 'employee')),
    employee_key TEXT,           -- non-null when kind='employee' (Cheryl, Woodhouse, ...)
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, workspace_id, client_id, kind, employee_key)
);

-- ----------------------------------------------------------------------------
-- 2. team_messages — every message, authored by user or an AI employee
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS team_messages (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_id      UUID NOT NULL REFERENCES team_chats (id) ON DELETE CASCADE,
    tenant_id    UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    role         TEXT NOT NULL CHECK (role IN ('user', 'employee', 'system')),
    employee_key TEXT,           -- which employee authored (null for user/system)
    content      TEXT NOT NULL,
    metadata     JSONB DEFAULT '{}'::jsonb,  -- tool calls, post ids, asset urls, handoffs
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_team_chats_tenant    ON team_chats (tenant_id);
CREATE INDEX IF NOT EXISTS idx_team_chats_scope     ON team_chats (tenant_id, workspace_id, kind);
CREATE INDEX IF NOT EXISTS idx_team_messages_chat   ON team_messages (chat_id, created_at);
CREATE INDEX IF NOT EXISTS idx_team_messages_tenant ON team_messages (tenant_id);

-- ----------------------------------------------------------------------------
-- 3. RLS — tenant isolation (same policy shape as tenant_ai_employees)
-- ----------------------------------------------------------------------------
ALTER TABLE team_chats    ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_messages ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    CREATE POLICY "tenant_isolation" ON team_chats
        FOR ALL USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE POLICY "tenant_isolation" ON team_messages
        FOR ALL USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
