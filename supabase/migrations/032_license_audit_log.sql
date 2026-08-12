-- Migration: 032_license_audit_log
--
-- Super-admin license actions (renew, plan change, revoke, issue) are logged
-- here so the platform has a paper trail: who did what, to which license, when.
-- Shown in the Super Admin → Licenses table (expandable) and kept for support.

CREATE TABLE IF NOT EXISTS license_audit_log (
    id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    license_id  UUID NOT NULL REFERENCES licenses (id) ON DELETE CASCADE,
    tenant_id   UUID,
    actor_email TEXT,
    action      TEXT NOT NULL,          -- 'issued' | 'plan_changed' | 'renewed' | 'revoked' | 'deleted'
    details     JSONB DEFAULT '{}',
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_license_audit_license
    ON license_audit_log (license_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_license_audit_tenant
    ON license_audit_log (tenant_id, created_at DESC);
