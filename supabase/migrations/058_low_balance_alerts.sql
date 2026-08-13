-- 058 — low-balance alert thresholds for the subscription registry
-- ============================================================================
-- Each provider can set a low_balance_threshold; when an auto-check finds
-- credit at or below it, the super admin is emailed (at most once per 24h,
-- tracked in low_balance_alerted_at, reset when credit recovers).

ALTER TABLE subscription_registry
    ADD COLUMN IF NOT EXISTS low_balance_threshold NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS low_balance_alerted_at TIMESTAMPTZ;

-- Sensible defaults (tune per provider in the UI; NULL = no alert).
UPDATE subscription_registry SET low_balance_threshold = 50   WHERE provider IN ('Stripe', 'Supabase');
UPDATE subscription_registry SET low_balance_threshold = 20   WHERE provider IN ('OpenAI', 'Google (Gemini/Imagen)', 'DeepSeek', 'Anthropic', 'Inngest');
UPDATE subscription_registry SET low_balance_threshold = 10   WHERE provider IN ('fal.ai', 'Alibaba DashScope', 'Bunny.net', 'Ayrshare', 'DocuSign');
UPDATE subscription_registry SET low_balance_threshold = 5000 WHERE provider = 'Resend';
