-- ============================================================================
-- Migration: 069_admin_access
-- Description:
--   Tenant opt-in for the platform super admin's "Login as" tool. When a
--   tenant's agency admin turns this ON, the super admin can enter their
--   panel to help (one-way only — the tenant never gains super admin
--   access). Off by default; the super admin can never force it on.
-- ============================================================================

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS allow_admin_access BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN tenants.allow_admin_access IS
  'Opt-in: when true, platform super admins may use "Login as" to enter this tenant. One-way — the tenant never gains super admin access.';
