-- ============================================================================
-- Migration: 102_content_map_external_links
--
-- Content Map rows may carry preferred EXTERNAL sources to cite (an optional
-- "External Links" CSV column — research links, statistics sources, partner
-- pages). Internal links are deliberately NOT stored per row: they come from
-- the workspace knowledge base (the client's site, crawled there) and are
-- attached automatically at generation time when available.
--
-- Optional by design: an empty external_links array is a normal state — the
-- post is generated exactly as before, just without preferred sources.
-- ============================================================================

ALTER TABLE content_map_items
  ADD COLUMN IF NOT EXISTS external_links TEXT[] NOT NULL DEFAULT '{}';
