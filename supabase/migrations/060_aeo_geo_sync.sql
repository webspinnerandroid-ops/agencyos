-- ============================================================================
-- Migration: 060_aeo_geo_sync
--
-- The SEO score column is kept in sync by a trigger that reads content->'seo'.
-- AEO/GEO was added to posts (migration 039) without an equivalent trigger, so
-- posts carrying content->'aeoGeo' (the manual generator, Cheryl's pipeline,
-- auto-rewrites) never got their aeo_geo_score column populated — the SEO
-- analytics tab and post list showed "—" for every post.
--
-- This extends the same trigger to sync aeo_geo_score from
-- content->'aeoGeo'->>'score' on every INSERT/UPDATE, and backfills rows that
-- already carry the payload. It also syncs the SEO/AEO/GEO columns when a
-- rewrite copies fresh content into an existing row.
-- ============================================================================

CREATE OR REPLACE FUNCTION sync_post_seo_columns() RETURNS trigger AS $$
BEGIN
  IF NEW.content IS NOT NULL AND NEW.content ? 'seo' THEN
    NEW.seo_score  := (NEW.content->'seo'->>'score')::int;
    NEW.seo_checks := NEW.content->'seo'->'checks';
  END IF;
  IF NEW.content IS NOT NULL AND NEW.content ? 'aeoGeo' THEN
    NEW.aeo_geo_score := (NEW.content->'aeoGeo'->>'score')::int;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_post_seo_columns ON posts;
CREATE TRIGGER trg_sync_post_seo_columns
  BEFORE INSERT OR UPDATE OF content ON posts
  FOR EACH ROW EXECUTE FUNCTION sync_post_seo_columns();

-- Backfill existing rows that carry the payload (idempotent).
UPDATE posts
SET aeo_geo_score = (content->'aeoGeo'->>'score')::int
WHERE content ? 'aeoGeo'
  AND content->'aeoGeo'->>'score' IS NOT NULL
  AND aeo_geo_score IS NULL;
