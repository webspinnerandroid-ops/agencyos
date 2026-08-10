-- ============================================================================
-- Migration: 009_seed_all_providers
-- Description: Seed all 34 AI/service providers and their models across 5
--              modalities: text (14), image (6), video (5), voice (5),
--              embedding (4). Also includes Ayrshare for social publishing.
--              Safe to run multiple times — ON CONFLICT DO NOTHING.
--              Does NOT delete the 4 providers seeded in 003.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- AI Providers (34 + 1 publishing service)
--
-- UUID ranges:
--   text:      00000000-0000-0000-0000-000000000001 … 014
--   image:     00000000-0000-0000-0000-000000000101 … 106
--   video:     00000000-0000-0000-0000-000000000201 … 205
--   voice:     00000000-0000-0000-0000-000000000301 … 305
--   embedding: 00000000-0000-0000-0000-000000000401 … 404
--   publishing:00000000-0000-0000-0000-000000000501
-- ----------------------------------------------------------------------------

-- TEXT providers (14) --------------------------------------------------------
INSERT INTO ai_providers (id, name, base_url, type) VALUES
  ('00000000-0000-0000-0000-000000000001', 'DeepSeek',      'https://api.deepseek.com/v1',       'text'),
  ('00000000-0000-0000-0000-000000000002', 'OpenAI',        'https://api.openai.com/v1',         'text'),
  ('00000000-0000-0000-0000-000000000003', 'Anthropic',     'https://api.anthropic.com/v1',      'text'),
  ('00000000-0000-0000-0000-000000000004', 'Google',        'https://generativelanguage.googleapis.com/v1beta', 'text'),
  ('00000000-0000-0000-0000-000000000005', 'Meta',          'https://api.meta.ai/v1',            'text'),
  ('00000000-0000-0000-0000-000000000006', 'Mistral',       'https://api.mistral.ai/v1',         'text'),
  ('00000000-0000-0000-0000-000000000007', 'Cohere',        'https://api.cohere.ai/v1',          'text'),
  ('00000000-0000-0000-0000-000000000008', 'xAI',           'https://api.x.ai/v1',               'text'),
  ('00000000-0000-0000-0000-000000000009', 'Perplexity',    'https://api.perplexity.ai',         'text'),
  ('00000000-0000-0000-0000-000000000010', 'Together AI',   'https://api.together.xyz/v1',       'text'),
  ('00000000-0000-0000-0000-000000000011', 'Fireworks',     'https://api.fireworks.ai/inference/v1', 'text'),
  ('00000000-0000-0000-0000-000000000012', 'Replicate',     'https://api.replicate.com/v1',      'text'),
  ('00000000-0000-0000-0000-000000000013', 'Groq',          'https://api.groq.com/openai/v1',    'text'),
  ('00000000-0000-0000-0000-000000000014', 'OpenRouter',    'https://openrouter.ai/api/v1',      'text')
ON CONFLICT (id) DO NOTHING;

-- IMAGE providers (6) --------------------------------------------------------
INSERT INTO ai_providers (id, name, base_url, type) VALUES
  ('00000000-0000-0000-0000-000000000101', 'OpenAI Image',   'https://api.openai.com/v1',        'image'),
  ('00000000-0000-0000-0000-000000000102', 'Stability AI',   'https://api.stability.ai/v1',      'image'),
  ('00000000-0000-0000-0000-000000000103', 'Midjourney',     'https://api.midjourney.com',       'image'),
  ('00000000-0000-0000-0000-000000000104', 'Leonardo AI',    'https://cloud.leonardo.ai/api/rest/v1', 'image'),
  ('00000000-0000-0000-0000-000000000105', 'Adobe Firefly',  'https://firefly-api.adobe.io/v1',  'image'),
  ('00000000-0000-0000-0000-000000000106', 'Ideogram',       'https://api.ideogram.ai/v1',       'image')
ON CONFLICT (id) DO NOTHING;

-- VIDEO providers (5) --------------------------------------------------------
INSERT INTO ai_providers (id, name, base_url, type) VALUES
  ('00000000-0000-0000-0000-000000000201', 'Runway',         'https://api.runwayml.com/v1',      'video'),
  ('00000000-0000-0000-0000-000000000202', 'HeyGen',         'https://api.heygen.com/v2',        'video'),
  ('00000000-0000-0000-0000-000000000203', 'Pika',           'https://api.pika.art/v1',          'video'),
  ('00000000-0000-0000-0000-000000000204', 'Synthesia',      'https://api.synthesia.io/v1',      'video'),
  ('00000000-0000-0000-0000-000000000205', 'Kaiber',         'https://api.kaiber.ai/v1',         'video')
ON CONFLICT (id) DO NOTHING;

-- VOICE providers (5) --------------------------------------------------------
INSERT INTO ai_providers (id, name, base_url, type) VALUES
  ('00000000-0000-0000-0000-000000000301', 'ElevenLabs',     'https://api.elevenlabs.io/v1',     'voice'),
  ('00000000-0000-0000-0000-000000000302', 'Play.ht',        'https://api.play.ht/api/v2',       'voice'),
  ('00000000-0000-0000-0000-000000000303', 'Murf',           'https://api.murf.ai/v1',           'voice'),
  ('00000000-0000-0000-0000-000000000304', 'Resemble',       'https://app.resemble.ai/api/v2',   'voice'),
  ('00000000-0000-0000-0000-000000000305', 'WellSaid',       'https://api.wellsaidlabs.com/v1',  'voice')
ON CONFLICT (id) DO NOTHING;

-- EMBEDDING providers (4) ----------------------------------------------------
INSERT INTO ai_providers (id, name, base_url, type) VALUES
  ('00000000-0000-0000-0000-000000000401', 'OpenAI Embedding', 'https://api.openai.com/v1',      'embedding'),
  ('00000000-0000-0000-0000-000000000402', 'Cohere Embed',     'https://api.cohere.ai/v1',       'embedding'),
  ('00000000-0000-0000-0000-000000000403', 'Voyage AI',        'https://api.voyageai.com/v1',    'embedding'),
  ('00000000-0000-0000-0000-000000000404', 'Jina AI',          'https://api.jina.ai/v1',         'embedding')
ON CONFLICT (id) DO NOTHING;

-- PUBLISHING services (1) ----------------------------------------------------
INSERT INTO ai_providers (id, name, base_url, type) VALUES
  ('00000000-0000-0000-0000-000000000501', 'Ayrshare',       'https://app.ayrshare.com/api',     'publishing')
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- AI Models
--
-- UUID scheme for models:
--   <provider_seq><model_seq>
--   e.g. provider 001 models start at 100…, provider 002 at 200…, etc.
--   Image providers (101-106) start at 1100…, etc.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- DeepSeek models (text) — provider 0000000001
-- ----------------------------------------------------------------------------
INSERT INTO ai_models (id, provider_id, model_identifier, supported_tasks) VALUES
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'deepseek-chat',             ARRAY['blog_generation','social_caption','seo_audit','seo_campaign_generation','email_generation','ad_copy']),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'deepseek-reasoner',         ARRAY['blog_generation','seo_audit','seo_campaign_generation'])
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- OpenAI models (text) — provider 0000000002
-- ----------------------------------------------------------------------------
INSERT INTO ai_models (id, provider_id, model_identifier, supported_tasks) VALUES
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'gpt-4o',                    ARRAY['blog_generation','social_caption','seo_audit','seo_campaign_generation','email_generation','ad_copy']),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', 'gpt-4o-mini',               ARRAY['blog_generation','social_caption']),
  ('20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000002', 'gpt-4.1',                   ARRAY['blog_generation','social_caption','seo_audit','seo_campaign_generation']),
  ('20000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000002', 'o1',                        ARRAY['seo_audit','seo_campaign_generation']),
  ('20000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000002', 'o3-mini',                   ARRAY['blog_generation','social_caption','seo_audit'])
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- Anthropic models (text) — provider 0000000003
-- ----------------------------------------------------------------------------
INSERT INTO ai_models (id, provider_id, model_identifier, supported_tasks) VALUES
  ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003', 'claude-3-5-sonnet-20241022', ARRAY['blog_generation','social_caption','seo_audit','seo_campaign_generation','email_generation','ad_copy']),
  ('30000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000003', 'claude-3-haiku-20240307',    ARRAY['blog_generation','social_caption']),
  ('30000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000003', 'claude-3-opus-20240229',     ARRAY['blog_generation','seo_audit','seo_campaign_generation']),
  ('30000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000003', 'claude-3-5-haiku-20241022',  ARRAY['blog_generation','social_caption'])
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- Google Gemini models (text) — provider 0000000004
-- ----------------------------------------------------------------------------
INSERT INTO ai_models (id, provider_id, model_identifier, supported_tasks) VALUES
  ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000004', 'gemini-2.0-flash',          ARRAY['blog_generation','social_caption','seo_audit','seo_campaign_generation']),
  ('40000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000004', 'gemini-2.0-pro',            ARRAY['blog_generation','seo_audit','seo_campaign_generation']),
  ('40000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000004', 'gemini-1.5-pro',            ARRAY['blog_generation','social_caption','seo_audit'])
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- Meta Llama models (text) — provider 0000000005
-- ----------------------------------------------------------------------------
INSERT INTO ai_models (id, provider_id, model_identifier, supported_tasks) VALUES
  ('50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000005', 'llama-3.3-70b',             ARRAY['blog_generation','social_caption','seo_audit']),
  ('50000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000005', 'llama-3.1-405b',            ARRAY['blog_generation','seo_audit','seo_campaign_generation'])
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- Mistral models (text) — provider 0000000006
-- ----------------------------------------------------------------------------
INSERT INTO ai_models (id, provider_id, model_identifier, supported_tasks) VALUES
  ('60000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000006', 'mistral-large',             ARRAY['blog_generation','social_caption','seo_audit','seo_campaign_generation']),
  ('60000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000006', 'mistral-small',             ARRAY['blog_generation','social_caption']),
  ('60000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000006', 'pixtral-large',             ARRAY['social_caption'])
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- Cohere models (text) — provider 0000000007
-- ----------------------------------------------------------------------------
INSERT INTO ai_models (id, provider_id, model_identifier, supported_tasks) VALUES
  ('70000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000007', 'command-r-plus',            ARRAY['blog_generation','social_caption','seo_audit']),
  ('70000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000007', 'command-r',                 ARRAY['blog_generation','social_caption'])
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- xAI Grok models (text) — provider 0000000008
-- ----------------------------------------------------------------------------
INSERT INTO ai_models (id, provider_id, model_identifier, supported_tasks) VALUES
  ('80000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000008', 'grok-2',                    ARRAY['blog_generation','social_caption','seo_audit']),
  ('80000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000008', 'grok-2-vision',             ARRAY['social_caption'])
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- Perplexity models (text) — provider 0000000009
-- ----------------------------------------------------------------------------
INSERT INTO ai_models (id, provider_id, model_identifier, supported_tasks) VALUES
  ('90000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000009', 'sonar-pro',                 ARRAY['blog_generation','seo_audit','seo_campaign_generation']),
  ('90000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000009', 'sonar-reasoning',           ARRAY['seo_audit','seo_campaign_generation'])
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- Together AI models (text) — provider 0000000010
-- ----------------------------------------------------------------------------
INSERT INTO ai_models (id, provider_id, model_identifier, supported_tasks) VALUES
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010', 'meta-llama/Llama-3.3-70B-Instruct-Turbo', ARRAY['blog_generation','social_caption','seo_audit']),
  ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000010', 'mistralai/Mixtral-8x22B-Instruct-v0.1',   ARRAY['blog_generation','social_caption'])
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- Fireworks models (text) — provider 0000000011
-- ----------------------------------------------------------------------------
INSERT INTO ai_models (id, provider_id, model_identifier, supported_tasks) VALUES
  ('b0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000011', 'accounts/fireworks/models/llama-v3p3-70b-instruct', ARRAY['blog_generation','social_caption']),
  ('b0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000011', 'accounts/fireworks/models/mixtral-8x22b-instruct',  ARRAY['blog_generation'])
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- Replicate models (text) — provider 0000000012
-- ----------------------------------------------------------------------------
INSERT INTO ai_models (id, provider_id, model_identifier, supported_tasks) VALUES
  ('c0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000012', 'meta/meta-llama-3-70b-instruct',       ARRAY['blog_generation','social_caption']),
  ('c0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000012', 'mistralai/mixtral-8x7b-instruct-v0.1', ARRAY['blog_generation'])
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- Groq models (text) — provider 0000000013
-- ----------------------------------------------------------------------------
INSERT INTO ai_models (id, provider_id, model_identifier, supported_tasks) VALUES
  ('d0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000013', 'llama-3.3-70b-versatile',   ARRAY['blog_generation','social_caption','seo_audit']),
  ('d0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000013', 'mixtral-8x7b-32768',        ARRAY['blog_generation','social_caption']),
  ('d0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000013', 'gemma2-9b-it',              ARRAY['social_caption'])
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- OpenRouter models (text) — provider 0000000014
-- ----------------------------------------------------------------------------
INSERT INTO ai_models (id, provider_id, model_identifier, supported_tasks) VALUES
  ('e0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000014', 'openai/gpt-4o',                ARRAY['blog_generation','social_caption','seo_audit','seo_campaign_generation']),
  ('e0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000014', 'anthropic/claude-3.5-sonnet',  ARRAY['blog_generation','social_caption','seo_audit','seo_campaign_generation']),
  ('e0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000014', 'google/gemini-2.0-flash-001',  ARRAY['blog_generation','social_caption','seo_audit'])
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- IMAGE models
-- ============================================================================

-- OpenAI Image (DALL-E) — provider 0000000101
INSERT INTO ai_models (id, provider_id, model_identifier, supported_tasks) VALUES
  ('11000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000101', 'dall-e-3',       ARRAY['image_generation']),
  ('11000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000101', 'dall-e-2',       ARRAY['image_generation'])
ON CONFLICT (id) DO NOTHING;

-- Stability AI — provider 0000000102
INSERT INTO ai_models (id, provider_id, model_identifier, supported_tasks) VALUES
  ('12000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000102', 'stable-diffusion-xl-1024-v1-0',  ARRAY['image_generation']),
  ('12000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000102', 'stable-diffusion-3.5-large',      ARRAY['image_generation']),
  ('12000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000102', 'stable-image-ultra',              ARRAY['image_generation'])
ON CONFLICT (id) DO NOTHING;

-- Midjourney — provider 0000000103
INSERT INTO ai_models (id, provider_id, model_identifier, supported_tasks) VALUES
  ('13000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000103', 'midjourney-v6.1',        ARRAY['image_generation']),
  ('13000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000103', 'midjourney-niji-v6',     ARRAY['image_generation'])
ON CONFLICT (id) DO NOTHING;

-- Leonardo AI — provider 0000000104
INSERT INTO ai_models (id, provider_id, model_identifier, supported_tasks) VALUES
  ('14000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000104', 'leonardo-phoenix',       ARRAY['image_generation']),
  ('14000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000104', 'leonardo-lightning',     ARRAY['image_generation'])
ON CONFLICT (id) DO NOTHING;

-- Adobe Firefly — provider 0000000105
INSERT INTO ai_models (id, provider_id, model_identifier, supported_tasks) VALUES
  ('15000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000105', 'firefly-image-v3',       ARRAY['image_generation'])
ON CONFLICT (id) DO NOTHING;

-- Ideogram — provider 0000000106
INSERT INTO ai_models (id, provider_id, model_identifier, supported_tasks) VALUES
  ('16000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000106', 'ideogram-v2',            ARRAY['image_generation']),
  ('16000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000106', 'ideogram-v2-turbo',      ARRAY['image_generation'])
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- VIDEO models
-- ============================================================================

-- Runway — provider 0000000201
INSERT INTO ai_models (id, provider_id, model_identifier, supported_tasks) VALUES
  ('21000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000201', 'gen-3-alpha',            ARRAY['video_generation']),
  ('21000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000201', 'gen-2',                  ARRAY['video_generation'])
ON CONFLICT (id) DO NOTHING;

-- HeyGen — provider 0000000202
INSERT INTO ai_models (id, provider_id, model_identifier, supported_tasks) VALUES
  ('22000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000202', 'heygen-avatar-v3',       ARRAY['video_generation']),
  ('22000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000202', 'heygen-video-translate',  ARRAY['video_generation'])
ON CONFLICT (id) DO NOTHING;

-- Pika — provider 0000000203
INSERT INTO ai_models (id, provider_id, model_identifier, supported_tasks) VALUES
  ('23000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000203', 'pika-2.0',               ARRAY['video_generation'])
ON CONFLICT (id) DO NOTHING;

-- Synthesia — provider 0000000204
INSERT INTO ai_models (id, provider_id, model_identifier, supported_tasks) VALUES
  ('24000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000204', 'synthesia-v2',           ARRAY['video_generation'])
ON CONFLICT (id) DO NOTHING;

-- Kaiber — provider 0000000205
INSERT INTO ai_models (id, provider_id, model_identifier, supported_tasks) VALUES
  ('25000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000205', 'kaiber-motion-v3',       ARRAY['video_generation'])
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- VOICE models
-- ============================================================================

-- ElevenLabs — provider 0000000301
INSERT INTO ai_models (id, provider_id, model_identifier, supported_tasks) VALUES
  ('31000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000301', 'eleven-multilingual-v2',  ARRAY['voice_synthesis']),
  ('31000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000301', 'eleven-turbo-v2.5',       ARRAY['voice_synthesis']),
  ('31000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000301', 'eleven-flash-v2.5',       ARRAY['voice_synthesis'])
ON CONFLICT (id) DO NOTHING;

-- Play.ht — provider 0000000302
INSERT INTO ai_models (id, provider_id, model_identifier, supported_tasks) VALUES
  ('32000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000302', 'playht-2.0-turbo',        ARRAY['voice_synthesis']),
  ('32000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000302', 'playht-2.0',              ARRAY['voice_synthesis'])
ON CONFLICT (id) DO NOTHING;

-- Murf — provider 0000000303
INSERT INTO ai_models (id, provider_id, model_identifier, supported_tasks) VALUES
  ('33000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000303', 'murf-gen2',               ARRAY['voice_synthesis'])
ON CONFLICT (id) DO NOTHING;

-- Resemble — provider 0000000304
INSERT INTO ai_models (id, provider_id, model_identifier, supported_tasks) VALUES
  ('34000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000304', 'resemble-v2',             ARRAY['voice_synthesis'])
ON CONFLICT (id) DO NOTHING;

-- WellSaid — provider 0000000305
INSERT INTO ai_models (id, provider_id, model_identifier, supported_tasks) VALUES
  ('35000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000305', 'wellsaid-v2',             ARRAY['voice_synthesis'])
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- EMBEDDING models
-- ============================================================================

-- OpenAI Embedding — provider 0000000401
INSERT INTO ai_models (id, provider_id, model_identifier, supported_tasks) VALUES
  ('41000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000401', 'text-embedding-3-large',  ARRAY['embeddings']),
  ('41000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000401', 'text-embedding-3-small',  ARRAY['embeddings']),
  ('41000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000401', 'text-embedding-ada-002',  ARRAY['embeddings'])
ON CONFLICT (id) DO NOTHING;

-- Cohere Embed — provider 0000000402
INSERT INTO ai_models (id, provider_id, model_identifier, supported_tasks) VALUES
  ('42000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000402', 'embed-english-v3.0',      ARRAY['embeddings']),
  ('42000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000402', 'embed-multilingual-v3.0', ARRAY['embeddings'])
ON CONFLICT (id) DO NOTHING;

-- Voyage AI — provider 0000000403
INSERT INTO ai_models (id, provider_id, model_identifier, supported_tasks) VALUES
  ('43000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000403', 'voyage-3-large',          ARRAY['embeddings']),
  ('43000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000403', 'voyage-3',                ARRAY['embeddings']),
  ('43000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000403', 'voyage-code-3',           ARRAY['embeddings'])
ON CONFLICT (id) DO NOTHING;

-- Jina AI — provider 0000000404
INSERT INTO ai_models (id, provider_id, model_identifier, supported_tasks) VALUES
  ('44000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000404', 'jina-embeddings-v3',      ARRAY['embeddings']),
  ('44000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000404', 'jina-clip-v2',            ARRAY['embeddings'])
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- PUBLISHING service models (Ayrshare)
-- ============================================================================
INSERT INTO ai_models (id, provider_id, model_identifier, supported_tasks) VALUES
  ('51000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000501', 'ayrshare-social-api',     ARRAY['social_publishing'])
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- COMPLETE
-- ============================================================================