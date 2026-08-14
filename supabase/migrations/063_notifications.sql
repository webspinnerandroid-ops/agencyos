-- 063 — notifications for the top-nav bell.
-- AI employees (chat, scheduled publish, approval flows) write rows here so
-- the user gets a red-dot bell with links back to the work.

CREATE TABLE IF NOT EXISTS notifications (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    user_id    UUID,                        -- null = all users in the tenant
    kind       TEXT NOT NULL DEFAULT 'info',-- info | progress | approval | alert
    title      TEXT NOT NULL,
    body       TEXT,
    link       TEXT,                        -- in-app URL to open
    read_at    TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_tenant
    ON notifications (tenant_id, created_at DESC);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "no_direct_access" ON notifications FOR ALL USING (false);
