-- Migration: 073_seed_current_models
--
-- Brings the model registry up to the current (Aug 2026) fal.ai lineup so the
-- Settings → AI → Task-Model Mapping pickers offer the models users actually
-- want to route video/image work to. All of these are hosted on fal.ai behind
-- one key, so they live under the existing fal.ai provider (…207) — one
-- fal.ai API key covers both video and image generation.
--
-- VIDEO:  Wan 2.5 / Wan 3.0, Seedance 2.5, MiniMax H3, Veo 3.1
-- IMAGE:  FLUX 1 Pro, FLUX 2, Nano Banana Pro, Recraft V3, GPT Image 2
--
-- Model identifiers are the fal.ai endpoint paths (https://fal.ai/models/<id>).
-- The Admin → APIs → "Verify fal.ai availability" button HEAD-checks each and
-- flags any that have been renamed/retired as deprecated, so a wrong path here
-- is surfaced and hidden from selectors rather than silently 404ing at runtime.
--
-- Idempotent — ON CONFLICT DO NOTHING.

-- ---------------------------------------------------------------------------
-- VIDEO models (fal.ai provider …207, type video)
-- ---------------------------------------------------------------------------
INSERT INTO ai_models (id, provider_id, model_identifier, supported_tasks) VALUES
  ('28000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000207', 'fal-ai/wan/v2.5/text-to-video',      ARRAY['video_generation']),
  ('28000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000207', 'fal-ai/wan/v2.5/image-to-video',     ARRAY['video_generation']),
  ('28000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000207', 'fal-ai/wan/v3.0/text-to-video',      ARRAY['video_generation']),
  ('28000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000207', 'fal-ai/wan/v3.0/image-to-video',     ARRAY['video_generation']),
  ('28000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000207', 'fal-ai/seedance/v2.5/text-to-video', ARRAY['video_generation']),
  ('28000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000207', 'fal-ai/seedance/v2.5/image-to-video',ARRAY['video_generation']),
  ('28000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000207', 'fal-ai/minimax/h3/text-to-video',    ARRAY['video_generation']),
  ('28000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000207', 'fal-ai/minimax/h3/image-to-video',   ARRAY['video_generation']),
  ('28000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000207', 'fal-ai/minimax/h3/subject-to-video', ARRAY['video_generation']),
  ('28000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000207', 'fal-ai/veo/3.1/text-to-video',       ARRAY['video_generation']),
  ('28000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000207', 'fal-ai/veo/3.1/image-to-video',      ARRAY['video_generation'])
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- IMAGE models (fal.ai provider …207 — one key covers video + image)
-- ---------------------------------------------------------------------------
INSERT INTO ai_models (id, provider_id, model_identifier, supported_tasks) VALUES
  ('29000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000207', 'fal-ai/flux-pro/v1.1',             ARRAY['image_generation']),
  ('29000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000207', 'fal-ai/flux-pro/v1.1-ultra',       ARRAY['image_generation']),
  ('29000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000207', 'fal-ai/flux/v2/dev',               ARRAY['image_generation']),
  ('29000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000207', 'fal-ai/flux/v2/pro',               ARRAY['image_generation']),
  ('29000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000207', 'fal-ai/gemini-pro/nano-banana-pro',ARRAY['image_generation']),
  ('29000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000207', 'fal-ai/gemini-pro/nano-banana',    ARRAY['image_generation']),
  ('29000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000207', 'fal-ai/recraft-v3',                ARRAY['image_generation']),
  ('29000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000207', 'fal-ai/gpt-image/2',               ARRAY['image_generation']),
  ('29000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000207', 'fal-ai/gpt-image/1',               ARRAY['image_generation'])
ON CONFLICT (id) DO NOTHING;
