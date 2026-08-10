-- ============================================================================
-- Migration: 015_seed_google_imagen
-- Description: Add Google Imagen provider and models for image generation.
--              Uses the Google GenAI SDK / Gemini API key (same as text models).
--              Safe to run multiple times — ON CONFLICT DO NOTHING.
-- ============================================================================

-- Google Imagen provider (image type)
INSERT INTO ai_providers (id, name, base_url, type) VALUES
  ('00000000-0000-0000-0000-000000000107', 'Google Imagen', 'https://generativelanguage.googleapis.com/v1beta', 'image')
ON CONFLICT (id) DO NOTHING;

-- Google Imagen models
INSERT INTO ai_models (id, provider_id, model_identifier, supported_tasks) VALUES
  ('17000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000107', 'imagen-3.0-generate-001', ARRAY['image_generation'])
ON CONFLICT (id) DO NOTHING;