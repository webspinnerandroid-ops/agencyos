-- Migration: 034_fal_ai_provider
--
-- Adds fal.ai as an alternative host for Wan video generation. Alibaba Wan
-- (DashScope) is provider id ...206; fal.ai is ...207 and hosts the same Wan
-- 2.1/2.2 models behind one API key. Users pick fal.ai in AI Settings, add a
-- "Key <your-fal-key>" API key, and map Video Generation to a fal model.
--
-- fal.ai model IDs are their hosted endpoint paths:
--   text-to-video:  fal-ai/wan/v2.2/text-to-video, fal-ai/wan/v2.1/text-to-video
--   image-to-video: fal-ai/wan/v2.2/image-to-video, fal-ai/wan/v2.1/image-to-video

INSERT INTO ai_providers (id, name, base_url, type) VALUES
  ('00000000-0000-0000-0000-000000000207', 'fal.ai', 'https://queue.fal.run', 'video')
ON CONFLICT (id) DO NOTHING;

INSERT INTO ai_models (id, provider_id, model_identifier, supported_tasks) VALUES
  ('27000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000207', 'fal-ai/wan/v2.2/text-to-video',  ARRAY['video_generation']),
  ('27000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000207', 'fal-ai/wan/v2.1/text-to-video',  ARRAY['video_generation']),
  ('27000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000207', 'fal-ai/wan/v2.2/image-to-video', ARRAY['video_generation']),
  ('27000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000207', 'fal-ai/wan/v2.1/image-to-video', ARRAY['video_generation'])
ON CONFLICT (id) DO NOTHING;
