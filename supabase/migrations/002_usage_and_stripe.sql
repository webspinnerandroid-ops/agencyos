-- ============================================================================
-- Migration: 002_usage_and_stripe
-- Description: Adds tenant_usage tracking table and extends subscriptions
--              for Stripe billing integration.
-- ============================================================================

-- 1. tenant_usage ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenant_usage (
    id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id     UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    metric        TEXT NOT NULL,
    count         INTEGER DEFAULT 0,
    period_start  TIMESTAMPTZ DEFAULT date_trunc('month', now()),
    created_at    TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tenant_usage_tenant  ON tenant_usage (tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_usage_metric  ON tenant_usage (tenant_id, metric);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_usage_unique ON tenant_usage (tenant_id, metric, period_start);

-- 2. Extend subscriptions table with Stripe fields ---------------------------
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ;

-- 3. RLS for tenant_usage ----------------------------------------------------
ALTER TABLE tenant_usage ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY "tenant_isolation" ON tenant_usage
        FOR ALL
        USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 4. Atomic usage increment RPC -----------------------------------------------
-- Called by the application to increment usage counters in a concurrency-safe
-- way. If no row exists for the current period, it creates one with count = 1;
-- otherwise it increments the existing count atomically.
CREATE OR REPLACE FUNCTION increment_usage(
  p_tenant_id UUID,
  p_metric    TEXT,
  p_amount    INTEGER DEFAULT 1
) RETURNS VOID AS $$
DECLARE
  v_period_start TIMESTAMPTZ;
BEGIN
  v_period_start := date_trunc('month', now());

  INSERT INTO tenant_usage (tenant_id, metric, count, period_start)
  VALUES (p_tenant_id, p_metric, p_amount, v_period_start)
  ON CONFLICT (tenant_id, metric, period_start)
  DO UPDATE SET count = tenant_usage.count + EXCLUDED.count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
