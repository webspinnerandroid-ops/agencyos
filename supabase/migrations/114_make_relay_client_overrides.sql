-- ============================================================================
-- Migration: 114_make_relay_client_overrides
--
-- Per-CLIENT webhook URLs for the Make.com relay. Before this migration a
-- tenant had ONE webhook for everything, so a single Make scenario could
-- route by platform but not by client. Now a tenant can optionally pin a
-- webhook PER CLIENT (one Make scenario per client — the cleanest
-- isolation: a client or VA gets just their own scenario):
--
--   make_relay_client_overrides (
--     tenant_id + client_id  unique pair
--     encrypted_url          hex string from encrypt() — TEXT, same
--                            convention as make_relay_config (migration
--                            112: supabase-js corrupts BYTEA params)
--     url_hint               "…last8" for display
--     enabled                soft toggle without deleting
--     last_test_*            per-override test outcome
--   )
--
-- Resolution order at publish time (makeRelay.ts): client override (when
-- enabled) → tenant-wide URL. No override and no tenant URL → clean skip
-- and the direct publisher fallback, exactly as before.
-- ============================================================================

CREATE TABLE IF NOT EXISTS make_relay_client_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  client_id UUID NOT NULL,
  encrypted_url TEXT NOT NULL,
  url_hint TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_test_at TIMESTAMPTZ,
  last_test_ok BOOLEAN,
  last_test_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, client_id)
);

CREATE INDEX IF NOT EXISTS idx_relay_overrides_client
  ON make_relay_client_overrides (client_id);
