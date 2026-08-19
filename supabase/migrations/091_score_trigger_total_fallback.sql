-- ============================================================================
-- Migration: 091_score_trigger_total_fallback
--
-- The Content Rewriter saves posts with content->'seo' and content->'aeoGeo'
-- carrying a `total` key (the scorer's result shape) instead of the canonical
-- `score` key the manual generator and AI team write. The sync trigger reads
-- `content->'seo'->>'score'` / `content->'aeoGeo'->>'score'`, so rewrite posts
-- never got their seo_score / aeo_geo_score columns populated — the post list
-- and SEO analytics tab showed "—" for every rewritten piece.
--
-- This makes the trigger fall back to `total` when `score` is absent (so any
-- writer can use either key), and backfills the rewrite posts that already
-- exist.
-- ============================================================================

CREATE OR REPLACE FUNCTION sync_post_seo_columns() RETURNS trigger AS $$
DECLARE
  v_seo_score   INTEGER;
  v_aeo_score   INTEGER;
BEGIN
  IF NEW.content IS NOT NULL AND NEW.content ? 'seo' THEN
    v_seo_score := (NEW.content->'seo'->>'score')::int;
    IF v_seo_score IS NULL THEN
      v_seo_score := (NEW.content->'seo'->>'total')::int;
    END IF;
    NEW.seo_score  := v_seo_score;
    NEW.seo_checks := NEW.content->'seo'->'checks';
  END IF;
  IF NEW.content IS NOT NULL AND NEW.content ? 'aeoGeo' THEN
    v_aeo_score := (NEW.content->'aeoGeo'->>'score')::int;
    IF v_aeo_score IS NULL THEN
      v_aeo_score := (NEW.content->'aeoGeo'->>'total')::int;
    END IF;
    NEW.aeo_geo_score := v_aeo_score;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_post_seo_columns ON posts;
CREATE TRIGGER trg_sync_post_seo_columns
  BEFORE INSERT OR UPDATE OF content ON posts
  FOR EACH ROW EXECUTE FUNCTION sync_post_seo_columns();

-- Backfill posts that carry a score under either key (idempotent).
UPDATE posts
SET seo_score = COALESCE(
      (content->'seo'->>'score')::int,
      (content->'seo'->>'total')::int
    )
WHERE content ? 'seo'
  AND seo_score IS NULL
  AND COALESCE(
        (content->'seo'->>'score')::int,
        (content->'seo'->>'total')::int
      ) IS NOT NULL;

UPDATE posts
SET aeo_geo_score = COALESCE(
      (content->'aeoGeo'->>'score')::int,
      (content->'aeoGeo'->>'total')::int
    )
WHERE content ? 'aeoGeo'
  AND aeo_geo_score IS NULL
  AND COALESCE(
        (content->'aeoGeo'->>'score')::int,
        (content->'aeoGeo'->>'total')::int
      ) IS NOT NULL;
