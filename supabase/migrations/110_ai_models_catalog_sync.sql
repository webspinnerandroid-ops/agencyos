-- ============================================================================
-- Migration: 110_ai_models_catalog_sync
--
-- Keeps the AI model catalog current automatically. The twice-daily cron
-- (Inngest "refresh-model-catalog") and the admin "Sync model catalogs"
-- button (POST /api/admin/models { sync: true }) upsert every model each
-- configured provider reports, so new models appear in pickers without a
-- migration and retired ones get flagged is_deprecated.
--
-- The upsert targets (provider_id, model_identifier) — that pairing needs a
-- UNIQUE constraint to exist. The 001 schema had none (re-running a seed
-- migration could duplicate rows), so this adds it, deduplicating any
-- existing pairs first. Also adds last_verified_at (the sync freshness stamp
-- the admin panel shows) for databases that predate migration 074.
-- ============================================================================

-- 1. Collapse duplicate (provider_id, model_identifier) pairs, keeping the
--    earliest row (lowest uuid → closest to the original seed insert).
DELETE FROM ai_models a
USING ai_models b
WHERE a.provider_id = b.provider_id
  AND a.model_identifier = b.model_identifier
  AND a.id > b.id;

-- 2. The constraint the upsert's ON CONFLICT clause requires.
ALTER TABLE ai_models
  DROP CONSTRAINT IF EXISTS ai_models_provider_model_unique;
ALTER TABLE ai_models
  ADD CONSTRAINT ai_models_provider_model_unique UNIQUE (provider_id, model_identifier);

-- 3. Freshness stamp (074 added it to newer databases; make it unconditional).
ALTER TABLE ai_models
  ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ;
