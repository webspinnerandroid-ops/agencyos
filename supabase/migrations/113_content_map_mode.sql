-- ============================================================================
-- Migration: 113_content_map_mode
--
-- Per-row generation MODE for the Content Map. The quality gate (SEO >= 80
-- AND AEO/GEO >= 80) remains the DEFAULT for every row — nothing about the
-- existing pipeline changes. 'fiction' is an explicit opt-in per row for
-- creative stories (fun/fiction blogs) where keyword scoring makes no sense:
-- the row still generates a draft with images, but skips scoring, the gate
-- loop, internal/external linking, and schema/SEO meta entirely.
--
-- Values:
--   'gate'    — default. Full score-gate pipeline, exactly as before.
--   'fiction' — creative mode. No scores, no gate, no linking/schema.
--
-- The CSV "Mode" column (fiction/story = fiction, anything else = gate)
-- and the Content Map row selector write this column.
-- ============================================================================

ALTER TABLE content_map_items
  ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'gate';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'content_map_items_mode_check'
  ) THEN
    ALTER TABLE content_map_items
      ADD CONSTRAINT content_map_items_mode_check
      CHECK (mode IN ('gate', 'fiction'));
  END IF;
END $$;
