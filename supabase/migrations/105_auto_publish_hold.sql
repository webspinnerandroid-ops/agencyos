-- ============================================================================
-- Migration: 105_auto_publish_hold
--
-- The 15-minute undo window for auto-published content-map rows.
--
-- A row marked auto_publish='wordpress' generates through the normal gate;
-- instead of scheduling to WordPress immediately, the resulting post is
-- HELD for 15 minutes (status stays `draft`) so a human can cancel. When
-- the hold expires, the hold processor (in-process timer in dev; the same
-- processDueHolds() seam can be driven by an Inngest cron in production)
-- approves the post and schedules it to the connected WordPress sites for
-- the row's planned publish date.
--
-- Semantics of the new column (posts.auto_publish_at TIMESTAMPTZ):
--   NULL                      — no automation; normal manual flow.
--   future timestamp          — hold armed; auto-publish at that instant.
--   past timestamp + draft    — due; the next processor pass picks it up.
--
-- Cancel = set auto_publish_at back to NULL (the draft is kept, the map
-- row keeps its linked draft, nothing publishes automatically).
--
-- Social auto-publish rides the SAME column: a social row with a publish
-- date sets auto_publish_at too, but the processor queues those posts to
-- the scheduled-posts cron (status 'scheduled') instead of calling
-- WordPress — the cron owns social publishing.
-- ============================================================================

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS auto_publish_at TIMESTAMPTZ;

-- The hold processor scans for due holds on every pass; this keeps that
-- scan an index-only probe even with millions of posts.
CREATE INDEX IF NOT EXISTS idx_posts_auto_publish_due
  ON posts (auto_publish_at)
  WHERE auto_publish_at IS NOT NULL;
