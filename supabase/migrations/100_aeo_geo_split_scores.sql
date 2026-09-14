-- ============================================================================
-- Migration: 100_aeo_geo_split_scores
--
-- The analytics dashboard's client reports average the *combined* AEO/GEO
-- readiness score (aeo_geo_score, migration 039/060), but the design doc
-- (docs/aeo-geo-scoring.md — "Client reports") calls for per-workspace
-- averages of all three scores: SEO, AEO (answer readiness) and GEO
-- (citation readiness). The combined column can't be split back into its
-- pillars, so this adds a small denormalized `aeo_geo_split` JSONB column
-- ({ aeo, geo }) synced by the same trigger that populates seo_score and
-- aeo_geo_score from content->'aeoGeo' (which stores aeoScore / geoScore).
--
-- Mirrors the pattern of 060_aeo_geo_sync: trigger sync + idempotent
-- backfill. Posts without a pillar payload get NULL — analytics skips them.
-- ============================================================================

ALTER TABLE posts ADD COLUMN IF NOT EXISTS aeo_geo_split JSONB;

CREATE OR REPLACE FUNCTION sync_post_seo_columns() RETURNS trigger AS $$
BEGIN
  IF NEW.content IS NOT NULL AND NEW.content ? 'seo' THEN
    NEW.seo_score  := (NEW.content->'seo'->>'score')::int;
    NEW.seo_checks := NEW.content->'seo'->'checks';
  END IF;
  IF NEW.content IS NOT NULL AND NEW.content ? 'aeoGeo' THEN
    NEW.aeo_geo_score := (NEW.content->'aeoGeo'->>'score')::int;
    -- Pillar split for per-workspace AEO / GEO averages (analytics client
    -- reports). jsonb_build_object keeps absent pillars as NULLs.
    NEW.aeo_geo_split := jsonb_build_object(
      'aeo', (NEW.content->'aeoGeo'->>'aeoScore')::int,
      'geo', (NEW.content->'aeoGeo'->>'geoScore')::int
    );
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
SET aeo_geo_split = jsonb_build_object(
      'aeo', (content->'aeoGeo'->>'aeoScore')::int,
      'geo', (content->'aeoGeo'->>'geoScore')::int
    )
WHERE content ? 'aeoGeo'
  AND aeo_geo_split IS NULL;
