-- Migration: 073_seed_current_models
--
-- Brings the model registry up to the current (Aug 2026) fal.ai lineup so the
-- Settings → AI → Task-Model Mapping pickers offer the models users actually
-- want to route video/image work to. All are hosted on fal.ai behind one key,
-- so they live under the existing fal.ai provider (…207) — one fal.ai API key
-- covers both video and image generation. (Partner namespaces like minimax/*
-- and openai/* are served through the same queue.fal.run endpoint.)
--
-- VIDEO:  Wan 2.7, Seedance 2.5, MiniMax H3, Veo 3.1 (image-to-video)
-- IMAGE:  FLUX 1 Pro, Nano Banana Pro, Recraft V3, GPT Image 2
--
-- Model identifiers below were VERIFIED against fal.ai model pages
-- (https://fal.ai/models/<id>) on 2026-08-16. Wan 2.5 is already present in
-- the DB as fal-ai/wan-25-preview/text-to-video (migration 035). If fal retires
-- one later, Admin → APIs → "Verify fal.ai availability" flags it deprecated.
--
-- Idempotent — ON CONFLICT DO NOTHING.

-- ---------------------------------------------------------------------------
-- VIDEO models (fal.ai provider …207, type video)
-- ---------------------------------------------------------------------------
INSERT INTO ai_models (id, provider_id, model_identifier, supported_tasks) VALUES
  ('28000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000207', 'fal-ai/wan/v2.7/text-to-video',       ARRAY['video_generation']),
  ('28000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000207', 'fal-ai/wan/v2.7/image-to-video',      ARRAY['video_generation']),
  ('28000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000207', 'minimax/h3/text-to-video',            ARRAY['video_generation']),
  ('28000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000207', 'minimax/h3/image-to-video',           ARRAY['video_generation']),
  ('28000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000207', 'minimax/h3/reference-to-video',       ARRAY['video_generation']),
  ('28000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000207', 'fal-ai/seedance-2-5/text-to-video',   ARRAY['video_generation']),
  ('28000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000207', 'fal-ai/veo3.1/image-to-video',        ARRAY['video_generation'])
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- IMAGE models (fal.ai provider …207 — one key covers video + image)
-- ---------------------------------------------------------------------------
INSERT INTO ai_models (id, provider_id, model_identifier, supported_tasks) VALUES
  ('29000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000207', 'fal-ai/flux-pro/v1.1',               ARRAY['image_generation']),
  ('29000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000207', 'fal-ai/flux-pro/v1.1-ultra',         ARRAY['image_generation']),
  ('29000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000207', 'fal-ai/recraft/v3/text-to-image',    ARRAY['image_generation']),
  ('29000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000207', 'fal-ai/nano-banana-pro',             ARRAY['image_generation']),
  ('29000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000207', 'openai/gpt-image-2',                 ARRAY['image_generation'])
ON CONFLICT (id) DO NOTHING;
