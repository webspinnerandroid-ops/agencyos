-- Migration: 038_model_registry_and_balances
--
-- 1. ai_models: deprecation + last-verified columns so the admin model
--    registry can flag retired/unavailable models and selectors skip them.
-- 2. tenant_settings: generic per-tenant JSONB settings (used by the
--    super-admin deploy/SSH config). Guarded with IF NOT EXISTS in case 036
--    already created it.
-- 3. provider_balances: last-known API balance per provider for the
--    super-admin "APIs & balances" panel + low-balance alerts.

ALTER TABLE ai_models ADD COLUMN IF NOT EXISTS is_deprecated BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE ai_models ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS tenant_settings (
    tenant_id    UUID PRIMARY KEY REFERENCES tenants (id) ON DELETE CASCADE,
    settings     JSONB NOT NULL DEFAULT '{}',
    updated_at   TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE tenant_settings ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS provider_balances (
    provider_id        UUID PRIMARY KEY REFERENCES ai_providers (id) ON DELETE CASCADE,
    balance_usd        NUMERIC,
    currency           TEXT,
    low_threshold_usd  NUMERIC NOT NULL DEFAULT 20,
    checked_at         TIMESTAMPTZ,
    updated_at         TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE provider_balances ENABLE ROW LEVEL SECURITY;
