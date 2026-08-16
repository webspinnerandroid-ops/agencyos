-- Migration: 071_admin_audit_log
--
-- General super-admin audit trail: every delete-user, delete-tenant,
-- role-change, hub-grant/revoke, and license action (including BLOCKED
-- attempts) is recorded here with the actor email, action, target, and
-- timestamp. Shown in Super Admin → Audit Log and kept for support/security.
--
-- Unlike license_audit_log (032), this table is not tied to a license row:
-- targets are identified by free-form type/id/label columns so one table
-- covers users, tenants, roles, hubs, and licenses.

CREATE TABLE IF NOT EXISTS admin_audit_log (
    id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    actor_email  TEXT,
    action       TEXT NOT NULL,          -- 'user_deleted' | 'tenant_deleted' | 'role_changed' | 'hub_granted' | 'hub_revoked' | 'license_deleted' | 'blocked_*'
    target_type  TEXT,                   -- 'user' | 'tenant' | 'role' | 'hub' | 'license'
    target_id    TEXT,
    target_label TEXT,                   -- human-readable: email, tenant name, etc.
    details      JSONB DEFAULT '{}',
    created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_created
    ON admin_audit_log (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_audit_action
    ON admin_audit_log (action, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_audit_actor
    ON admin_audit_log (actor_email, created_at DESC);

-- No RLS: this table is written/read only by the service role from server
-- actions. Add a blanket deny for anon/authenticated as a belt-and-suspenders.
ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'admin_audit_log' AND policyname = 'admin_audit_log_no_direct_access'
  ) THEN
    CREATE POLICY admin_audit_log_no_direct_access ON admin_audit_log
      FOR ALL USING (false) WITH CHECK (false);
  END IF;
END $$;
