-- ============================================================================
-- Migration: 013_deepseek_v4_models
-- Description: Phase 4 follow-up — Add DeepSeek V4 Pro and V4 Flash models
--              to ai_models. Update old deepseek-chat/reasoner to V4 variants.
-- ============================================================================

-- DeepSeek provider ID: 00000000-0000-0000-0000-000000000001

-- 1. Add DeepSeek V4 Pro (supports all text tasks including tool calling)
INSERT INTO ai_models (id, provider_id, model_identifier, supported_tasks)
VALUES (
  '10000000-0000-0000-0000-000000000013',
  '00000000-0000-0000-0000-000000000001',
  'deepseek-v4-pro',
  ARRAY['blog_generation','social_caption','seo_audit','seo_campaign_generation','email_generation','ad_copy']
) ON CONFLICT (id) DO UPDATE SET
  model_identifier = EXCLUDED.model_identifier,
  supported_tasks = EXCLUDED.supported_tasks;

-- 2. Add DeepSeek V4 Flash (fast/cheap, text-only, no tool calling)
INSERT INTO ai_models (id, provider_id, model_identifier, supported_tasks)
VALUES (
  '10000000-0000-0000-0000-000000000014',
  '00000000-0000-0000-0000-000000000001',
  'deepseek-v4-flash',
  ARRAY['blog_generation','social_caption','email_generation','ad_copy']
) ON CONFLICT (id) DO UPDATE SET
  model_identifier = EXCLUDED.model_identifier,
  supported_tasks = EXCLUDED.supported_tasks;