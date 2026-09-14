-- ============================================================================
-- Migration: 103_content_map_schedule
--
-- The Content Map now carries a per-row PUBLISH SCHEDULE. Two sources:
--   1. The CSV's optional "Publish Date" column (the client's suggested
--      date/time for the piece — blogs and social rows alike).
--   2. Manual scheduling on the map row (datetime picker) before or after
--      generation.
--
-- The value is a PLANNING date: it shows on the map row and flows into the
-- generated draft as the suggested publish time. The draft itself still goes
-- through the normal approval flow (draft → approved → scheduled → published)
-- before the existing Inngest publish cron (publish-scheduled-posts) pushes
-- it out. NULL = no schedule planned (fully optional; rows without one
-- generate exactly as before).
--
-- Idempotent: safe to run twice.
-- ============================================================================

ALTER TABLE content_map_items
  ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;
