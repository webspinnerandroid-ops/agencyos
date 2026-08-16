-- ============================================================================
-- Migration: 076_fix_recraft_endpoint
-- Description:
--   The canonical fal.ai endpoint for Recraft V3 is `fal-ai/recraft-v3`
--   (per fal's API docs). Migration 073 seeded a legacy-style alias
--   (`fal-ai/recraft/v3/text-to-image`) that can sit in the queue without
--   completing, surfacing as "fal.ai image generation timed out". Point the
--   row at the canonical endpoint. Idempotent.
-- ============================================================================

UPDATE ai_models
SET model_identifier = 'fal-ai/recraft-v3'
WHERE model_identifier = 'fal-ai/recraft/v3/text-to-image';

-- Ensure the canonical identifier exists even if the alias was never seeded.
INSERT INTO ai_models (id, provider_id, model_identifier, supported_tasks)
VALUES
  ('29000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000207', 'fal-ai/recraft-v3', ARRAY['image_generation'])
ON CONFLICT (id) DO UPDATE SET
  model_identifier = EXCLUDED.model_identifier,
  supported_tasks = EXCLUDED.supported_tasks;
