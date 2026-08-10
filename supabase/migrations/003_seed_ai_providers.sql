-- ============================================================================
-- Migration: 003_seed_ai_providers
-- Description: Seed ai_providers and ai_models with common providers (DeepSeek,
--              OpenAI, Anthropic, Stability AI). Safe to run multiple times
--              because we use ON CONFLICT DO NOTHING.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- AI Providers
-- ----------------------------------------------------------------------------
INSERT INTO ai_providers (id, name, base_url, type) VALUES
  ('00000000-0000-0000-0000-000000000001', 'DeepSeek', 'https://api.deepseek.com/v1', 'text'),
  ('00000000-0000-0000-0000-000000000002', 'OpenAI',   'https://api.openai.com/v1',     'text'),
  ('00000000-0000-0000-0000-000000000003', 'Anthropic', 'https://api.anthropic.com/v1',   'text'),
  ('00000000-0000-0000-0000-000000000004', 'Stability AI', 'https://api.stability.ai/v1', 'image')
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- AI Models
-- ----------------------------------------------------------------------------

-- DeepSeek models (text)
INSERT INTO ai_models (id, provider_id, model_identifier, supported_tasks) VALUES
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'deepseek-chat',          ARRAY['blog_generation', 'social_caption', 'seo_audit', 'seo_campaign_generation']),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'deepseek-reasoner',      ARRAY['blog_generation', 'seo_audit', 'seo_campaign_generation'])
ON CONFLICT (id) DO NOTHING;

-- OpenAI models (text + image)
INSERT INTO ai_models (id, provider_id, model_identifier, supported_tasks) VALUES
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'gpt-4o',             ARRAY['blog_generation', 'social_caption', 'seo_audit', 'seo_campaign_generation']),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', 'gpt-4o-mini',        ARRAY['blog_generation', 'social_caption']),
  ('20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000002', 'gpt-4.1',            ARRAY['blog_generation', 'social_caption', 'seo_audit', 'seo_campaign_generation']),
  ('20000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000002', 'dall-e-3',           ARRAY['image_generation'])
ON CONFLICT (id) DO NOTHING;

-- Anthropic models (text)
INSERT INTO ai_models (id, provider_id, model_identifier, supported_tasks) VALUES
  ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003', 'claude-3-5-sonnet-20241022', ARRAY['blog_generation', 'social_caption', 'seo_audit', 'seo_campaign_generation']),
  ('30000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000003', 'claude-3-haiku-20240307',    ARRAY['blog_generation', 'social_caption'])
ON CONFLICT (id) DO NOTHING;

-- Stability AI models (image)
INSERT INTO ai_models (id, provider_id, model_identifier, supported_tasks) VALUES
  ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000004', 'stable-diffusion-xl-1024-v1-0', ARRAY['image_generation']),
  ('40000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000004', 'stable-diffusion-3.5-large',     ARRAY['image_generation'])
ON CONFLICT (id) DO NOTHING;