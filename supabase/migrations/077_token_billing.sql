-- ============================================================================
-- Migration: 077_token_billing
-- Description:
--   Usage-based billing on top of the existing subscriptions. Tenants get a
--   monthly USD allowance (set per plan) plus purchasable add-on tokens (min
--   $20, all prices USD). Usage is metered per token per model (input/output
--   priced separately); image/video/voice assets are metered per asset at the
--   model's asset price.
--
--   Tables:
--     token_plans      — plan_id (Stripe price id) → monthly allowance USD
--     token_addons     — purchasable add-on denominations (>= $20)
--     model_rates      — per-model pricing (keyed by model_identifier so the
--                        metering hook can look rates up without a join)
--     token_ledger     — append-only usage/purchase/allowance/refund rows
--     tenant_balances  — live balances per tenant
--
--   NOTE: model_rates is keyed by model_identifier (TEXT) rather than
--   ai_models.id so the orchestrator can record usage by identifier without
--   an extra lookup; rates can exist for identifiers not yet in ai_models.
-- ============================================================================

-- 1. Per-plan monthly token allowance (Stripe price id -> USD credit/month)
CREATE TABLE IF NOT EXISTS token_plans (
    plan_id                   TEXT PRIMARY KEY,
    label                     TEXT NOT NULL DEFAULT '',
    monthly_token_allowance_usd NUMERIC(12, 4) NOT NULL DEFAULT 0,
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Purchasable add-on denominations (min $20 enforced in the app layer)
CREATE TABLE IF NOT EXISTS token_addons (
    id        UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    label     TEXT NOT NULL,
    price_usd NUMERIC(12, 2) NOT NULL DEFAULT 20 CHECK (price_usd >= 20),
    active    BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Per-model pricing (USD). input/output are per 1M tokens; asset is per
--    image/video/voice call. Null = no rate recorded yet (costs 0 until set).
CREATE TABLE IF NOT EXISTS model_rates (
    model_identifier  TEXT PRIMARY KEY,
    input_per_1m_usd  NUMERIC(12, 6),
    output_per_1m_usd NUMERIC(12, 6),
    asset_price_usd   NUMERIC(12, 6),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Append-only ledger. unit_type: token_in | token_out | asset.
--    type: usage | allowance | purchase | refund | expiry | adjustment.
CREATE TABLE IF NOT EXISTS token_ledger (
    id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id    UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    workspace_id UUID,
    type         TEXT NOT NULL DEFAULT 'usage',
    unit_type    TEXT NOT NULL,
    unit_qty     NUMERIC(20, 4) NOT NULL DEFAULT 0,
    rate_usd     NUMERIC(12, 6) NOT NULL DEFAULT 0,
    total_usd    NUMERIC(12, 6) NOT NULL DEFAULT 0,
    model_identifier TEXT,
    task         TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_token_ledger_tenant ON token_ledger (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_token_ledger_type ON token_ledger (type, created_at DESC);

-- 5. Live balances. monthly_allowance_usd is refreshed from token_plans at the
--    billing cycle start; addon_balance_usd is the prepaid top-up balance.
CREATE TABLE IF NOT EXISTS tenant_balances (
    tenant_id             UUID PRIMARY KEY REFERENCES tenants (id) ON DELETE CASCADE,
    monthly_allowance_usd NUMERIC(12, 6) NOT NULL DEFAULT 0,
    used_this_cycle_usd   NUMERIC(12, 6) NOT NULL DEFAULT 0,
    cycle_start           TIMESTAMPTZ NOT NULL DEFAULT now(),
    addon_balance_usd     NUMERIC(12, 6) NOT NULL DEFAULT 0,
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. RLS: service-layer only (same pattern as admin_audit_log) — no direct
--    client access to balances or ledger.
ALTER TABLE token_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE token_addons ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE token_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_balances ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY token_no_direct_access ON token_plans FOR ALL USING (false) WITH CHECK (false);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY token_no_direct_access ON token_addons FOR ALL USING (false) WITH CHECK (false);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY token_no_direct_access ON model_rates FOR ALL USING (false) WITH CHECK (false);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY token_no_direct_access ON token_ledger FOR ALL USING (false) WITH CHECK (false);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY token_no_direct_access ON tenant_balances FOR ALL USING (false) WITH CHECK (false);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 7. Seed default add-on denominations (min $20, USD).
INSERT INTO token_addons (label, price_usd, sort_order) VALUES
  ('20 USD',   20.00, 1),
  ('50 USD',   50.00, 2),
  ('100 USD', 100.00, 3),
  ('250 USD', 250.00, 4),
  ('500 USD', 500.00, 5)
ON CONFLICT DO NOTHING;

-- 8. Seed reference per-1M-token rates for the known text models (USD, list
--    prices as of Aug 2026 — the super admin can adjust them monthly).
INSERT INTO model_rates (model_identifier, input_per_1m_usd, output_per_1m_usd) VALUES
  ('deepseek-v4-flash', 0.07, 0.27),
  ('deepseek-v4-pro',   0.28, 0.42),
  ('gpt-4o',            2.50, 10.00),
  ('gemini-2.5-flash',  0.10, 0.40)
ON CONFLICT (model_identifier) DO UPDATE SET
  input_per_1m_usd = EXCLUDED.input_per_1m_usd,
  output_per_1m_usd = EXCLUDED.output_per_1m_usd;
