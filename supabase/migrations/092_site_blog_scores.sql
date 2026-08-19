-- ============================================================================
-- Migration: 092_site_blog_scores
--
-- Add quality score columns to site_blog_posts so published marketing-site
-- posts display their SEO / AEO-GEO scores like workspace content does.
-- Scores are stamped from the source post when generated content is published
-- to /blog via the Publish button; the super admin's manual posts stay null
-- until they run a rewrite/audit on the piece.
-- ============================================================================

ALTER TABLE site_blog_posts ADD COLUMN IF NOT EXISTS seo_score     INTEGER;
ALTER TABLE site_blog_posts ADD COLUMN IF NOT EXISTS aeo_geo_score INTEGER;
