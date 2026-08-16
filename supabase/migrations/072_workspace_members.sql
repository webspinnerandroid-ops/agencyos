-- Migration: 072_workspace_members
--
-- Per-workspace team isolation. A "team account" (a tenant with more than one
-- user_roles row) can grant individual members access to specific workspaces
-- only. Once ANY workspace_members row exists for a tenant, non-owner members
-- are locked to the workspaces they are explicitly granted (owner roles —
-- super_admin and agency_admin — always see everything). Tenants with no rows
-- keep the legacy "everyone sees every workspace" behavior, so existing
-- single-member tenants are unaffected.
--
-- Access is service-role only (RLS deny-all), same as admin_audit_log.

CREATE TABLE IF NOT EXISTS workspace_members (
    id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id    UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    user_id      UUID NOT NULL,
    granted_by   UUID,                     -- super admin who approved the grant
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_members_tenant_user
    ON workspace_members (tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace
    ON workspace_members (workspace_id);

ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'workspace_members' AND policyname = 'workspace_members_no_direct_access'
  ) THEN
    CREATE POLICY workspace_members_no_direct_access ON workspace_members
      FOR ALL USING (false) WITH CHECK (false);
  END IF;
END $$;
