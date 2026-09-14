-- ============================================================================
-- Migration: 109_publish_failure_resolution
--
-- Resolve actions for persistent publish failures (the Scheduled panel's
-- "Retry now" / "Dismiss"):
--
--   publish_failed_at      — when the post entered its CURRENT failed spell
--                          (set by the retry sweeper on first observation of
--                          a failure; cleared when the post publishes). The
--                          panel and the health email use it for "failed
--                          since" and to attribute failures to a week.
--   publish_dismissed_at   — set when a human dismisses the failure ("won't
--                          fix"). Dismissed posts leave the persistent-
--                          failures list; status stays `failed` so the
--                          history isn't rewritten. Undo = clear the column.
--   publish_dismiss_reason — free-text why it was dismissed, shown on the
--                          panel row so the next person sees the decision.
--
-- "Retry now" reuses the existing ladder columns: it clears
-- publish_retry_count / publish_dismissed_at and sets publish_retry_at = now,
-- which re-enters the sweeper as a fresh attempt (recovery counting for the
-- health email keys off publish_retry_count > 0 + published).
-- ============================================================================

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS publish_failed_at timestamptz,
  ADD COLUMN IF NOT EXISTS publish_dismissed_at timestamptz,
  ADD COLUMN IF NOT EXISTS publish_dismiss_reason text;

-- Panel index: failed posts whose ladder is exhausted and not dismissed.
CREATE INDEX IF NOT EXISTS idx_posts_publish_failed_open
  ON posts (publish_failed_at)
  WHERE status = 'failed'
    AND publish_failed_at IS NOT NULL
    AND publish_dismissed_at IS NULL;
