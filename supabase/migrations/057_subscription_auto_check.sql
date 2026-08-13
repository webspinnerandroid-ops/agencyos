-- 057 — subscription registry: fal.ai balance + OpenAI/Google key checks
-- ============================================================================
-- fal.ai exposes a real credit-balance endpoint; OpenAI and Google AI
-- (Gemini/Imagen) do NOT expose balance via API key, so their auto-checks
-- validate the key and explain that the number must come from the portal.

ALTER TABLE subscription_registry
    DROP CONSTRAINT IF EXISTS subscription_registry_auto_check_check;

ALTER TABLE subscription_registry
    ADD CONSTRAINT subscription_registry_auto_check_check
    CHECK (auto_check IN ('stripe','resend','fal','openai','google','manual'));

UPDATE subscription_registry SET auto_check = 'fal'    WHERE provider = 'fal.ai';
UPDATE subscription_registry SET auto_check = 'openai' WHERE provider = 'OpenAI';
UPDATE subscription_registry SET auto_check = 'google' WHERE provider = 'Google (Gemini/Imagen)';
