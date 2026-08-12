-- Migration: 031_wan_video_provider
--
-- Adds Alibaba's Wan video models (Wan 2.2 / Wan 2.1) as a video provider
-- so they are selectable in AI Settings → Task-Model Mapping for the
-- "Video Generation" task, independently of the text/image providers.
--
-- Wan is served through Alibaba Cloud Model Studio (DashScope):
--   https://dashscope.aliyuncs.com/api/v1
-- Model identifiers follow the DashScope naming (wan2.2-t2v-flash, etc.).
-- Idempotent — ON CONFLICT DO NOTHING.

INSERT INTO ai_providers (id, name, base_url, type) VALUES
  ('00000000-0000-0000-0000-000000000206', 'Alibaba Wan', 'https://dashscope.aliyuncs.com/api/v1', 'video')
ON CONFLICT (id) DO NOTHING;

INSERT INTO ai_models (id, provider_id, model_identifier, supported_tasks) VALUES
  ('26000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000206', 'wan2.2-t2v-flash',       ARRAY['video_generation']),
  ('26000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000206', 'wan2.1-t2v-14b',         ARRAY['video_generation']),
  ('26000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000206', 'wan2.1-t2v-turbo',       ARRAY['video_generation']),
  ('26000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000206', 'wan2.1-i2v-14b-720p',    ARRAY['video_generation']),
  ('26000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000206', 'wan2.2-i2v-flash',       ARRAY['video_generation'])
ON CONFLICT (id) DO NOTHING;
