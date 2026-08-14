-- ============================================================================
-- Migration: 065_landing_page_builder
--
-- Adds a `landing_content` JSONB column to the single site_settings row (id=1)
-- so the super admin can edit the public landing page's marketing copy in a
-- visual builder (hero, features, how-it-works, testimonials, logo strip,
-- FAQ, CTA). The landing page falls back to compiled defaults when the column
-- is null or a field is missing, so the public site never breaks on partial
-- content.
-- ============================================================================

ALTER TABLE site_settings
  ADD COLUMN IF NOT EXISTS landing_content JSONB;

-- Null by default: the app treats NULL and {} as "use compiled defaults".
COMMENT ON COLUMN site_settings.landing_content IS
  'Super-admin editable marketing copy for the public landing page (hero, features, how-it-works, testimonials, logo strip, FAQ, CTA). NULL = compiled defaults.';
