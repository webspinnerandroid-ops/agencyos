-- Migration: 035_fal_wan_model_ids
--
-- Fixes migration 034: the seeded fal.ai Wan identifiers did not exist on
-- fal.ai (404s). Real fal.ai model paths (verified against fal.ai model docs):
--   fal-ai/wan/v2.2-a14b/text-to-video
--   fal-ai/wan/v2.2-a14b/image-to-video
--   fal-ai/wan/v2.1/1.3b/text-to-video
--   fal-ai/wan-25-preview/text-to-video
-- Idempotent: UPDATE by fixed model id, INSERT for the new preview model.

UPDATE ai_models SET model_identifier = 'fal-ai/wan/v2.2-a14b/text-to-video'
  WHERE id = '27000000-0000-0000-0000-000000000001';

UPDATE ai_models SET model_identifier = 'fal-ai/wan/v2.1/1.3b/text-to-video'
  WHERE id = '27000000-0000-0000-0000-000000000002';

UPDATE ai_models SET model_identifier = 'fal-ai/wan/v2.2-a14b/image-to-video'
  WHERE id = '27000000-0000-0000-0000-000000000003';

UPDATE ai_models SET model_identifier = 'fal-ai/wan-25-preview/text-to-video'
  WHERE id = '27000000-0000-0000-0000-000000000004';
