-- ============================================================================
-- Migration: 074_seed_kling_models
-- Description:
--   Adds the fal.ai Kling family to the model registry (video + image), with
--   every endpoint verified against fal.ai's published model pages:
--     - Kling 3.0 (v3) pro / standard, text-to-video + image-to-video
--     - Kling O3 pro / standard, text-to-video + image-to-video + reference-to-video
--     - Kling 2.1 Master (text-to-video)
--     - Kling Image 3.0 (text-to-image + image-to-image)
--   Also tags every image-generation model with the `brand_design` task so the
--   Brand & Vector Design page and the task-model mapping picker can offer the
--   right models (migration 073 models carry only `image_generation`).
--
--   Idempotent: purges any stale/guessed Kling identifiers first, then upserts
--   by fixed ID. Requires the fal.ai provider row from migration 034
--   (00000000-0000-0000-0000-000000000207).
-- ============================================================================

-- 1. Purge any previously-guessed Kling identifiers (no-ops if absent)
DELETE FROM ai_models WHERE model_identifier LIKE 'fal-ai/kling-%';

-- 2. Kling VIDEO models (verified against fal.ai)
INSERT INTO ai_models (id, provider_id, model_identifier, supported_tasks) VALUES
  -- Kling 3.0 (v3) — pro tier
  ('2B000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000207', 'fal-ai/kling-video/v3/pro/text-to-video',      ARRAY['video_generation']),
  ('2B000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000207', 'fal-ai/kling-video/v3/pro/image-to-video',     ARRAY['video_generation']),
  -- Kling 3.0 (v3) — standard tier
  ('2B000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000207', 'fal-ai/kling-video/v3/standard/text-to-video', ARRAY['video_generation']),
  ('2B000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000207', 'fal-ai/kling-video/v3/standard/image-to-video',ARRAY['video_generation']),
  -- Kling O3 — pro tier
  ('2B000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000207', 'fal-ai/kling-video/o3/pro/text-to-video',       ARRAY['video_generation']),
  ('2B000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000207', 'fal-ai/kling-video/o3/pro/reference-to-video',  ARRAY['video_generation']),
  -- Kling O3 — standard tier
  ('2B000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000207', 'fal-ai/kling-video/o3/standard/text-to-video', ARRAY['video_generation']),
  ('2B000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000207', 'fal-ai/kling-video/o3/standard/image-to-video',ARRAY['video_generation']),
  ('2B000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000207', 'fal-ai/kling-video/o3/standard/reference-to-video', ARRAY['video_generation']),
  -- Kling 2.1 Master
  ('2B000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000207', 'fal-ai/kling-video/v2.1/master/text-to-video', ARRAY['video_generation'])
ON CONFLICT (id) DO UPDATE SET
  model_identifier = EXCLUDED.model_identifier,
  supported_tasks = EXCLUDED.supported_tasks;

-- 3. Kling IMAGE models (verified against fal.ai)
INSERT INTO ai_models (id, provider_id, model_identifier, supported_tasks) VALUES
  ('2C000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000207', 'fal-ai/kling-image/v3/text-to-image',   ARRAY['image_generation', 'brand_design']),
  ('2C000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000207', 'fal-ai/kling-image/v3/image-to-image',  ARRAY['image_generation', 'brand_design'])
ON CONFLICT (id) DO UPDATE SET
  model_identifier = EXCLUDED.model_identifier,
  supported_tasks = EXCLUDED.supported_tasks;

-- 4. Tag every image-capable model with the brand_design task so the Brand &
--    Vector Design page and mapping picker can offer them. This covers the
--    models seeded by migration 073 (FLUX, Recraft, Nano Banana, GPT Image,
--    Kling image above) plus any future image models.
UPDATE ai_models
SET supported_tasks = supported_tasks || ARRAY['brand_design']
WHERE 'image_generation' = ANY(supported_tasks)
  AND NOT ('brand_design' = ANY(supported_tasks));
