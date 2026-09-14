-- 096 — brand_profiles.custom_instructions
-- The app writes/reads custom_instructions on brand profiles, but this column
-- was never applied to the production brand_profiles table (only existed in the
-- local 006 file). Added guard-railed so it is safe to apply to any state; this
-- was already applied out-of-band, this file records it in the migration history.
ALTER TABLE brand_profiles ADD COLUMN IF NOT EXISTS custom_instructions TEXT;