-- ============================================================================
-- Migration: 045_seed_google_image_models
-- Description: Seed the Google Imagen / Nano Banana image model family.
--              The orchestrator routes "imagen-*" models through the predict
--              endpoint and "gemini-*-image" models through generateContent,
--              so both families are usable from the image generator.
--              Idempotent — safe to re-run.
-- ============================================================================

-- Google Imagen provider (seeded in 015 as id …107)
INSERT INTO ai_models (id, provider_id, model_identifier, supported_tasks) VALUES
  ('47000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000107', 'imagen-4.0',          ARRAY['image_generation']),
  ('47000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000107', 'imagen-4.0-fast',     ARRAY['image_generation']),
  ('47000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000107', 'gemini-2.5-flash-image-preview', ARRAY['image_generation'])
ON CONFLICT (id) DO NOTHING;

-- If a model ID is no longer offered by Google, deprecate it (is_deprecated = true)
-- from the Admin → APIs & Model Registry panel instead of deleting the row.
