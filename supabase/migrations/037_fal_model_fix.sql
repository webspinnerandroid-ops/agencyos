-- Migration: 037_fal_model_fix
--
-- `fal-ai/wan/v2.1/1.3b/text-to-video` does not exist on fal.ai (404 on their
-- model page). Verified live fal.ai model paths (checked against
-- fal.ai/models/<id>):
--   fal-ai/wan/v2.2-a14b/text-to-video        ✓
--   fal-ai/wan/v2.2-a14b/image-to-video       ✓
--   fal-ai/wan-25-preview/text-to-video       ✓
--   fal-ai/wan-pro/text-to-video              ✓ (replacement)
--   fal-ai/wan-i2v                            ✓ (image-to-video)

UPDATE ai_models SET model_identifier = 'fal-ai/wan-pro/text-to-video'
  WHERE id = '27000000-0000-0000-0000-000000000002';

-- Add the validated WAN image-to-video model as well.
INSERT INTO ai_models (id, provider_id, model_identifier, supported_tasks) VALUES
  ('27000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000207', 'fal-ai/wan-i2v', ARRAY['video_generation'])
ON CONFLICT (id) DO NOTHING;
