-- ============================================================================
-- Migration: 106_publish_retry_backoff
--
-- Self-healing for failed publishes. The publish cron flips a post to
-- `failed` when platform delivery throws; until now it stayed failed until
-- a human retried. This adds the backoff-ladder state to `posts`:
--
--   publish_retry_count — automatic retries already run (NULL/0 = only the
--                         original failure so far)
--   publish_retry_at    — when the NEXT retry is due (NULL = nothing
--                         pending: never retried yet, succeeded, or the
--                         ladder exhausted and the post was escalated)
--
-- Backoff ladder (see src/lib/publishing/retryFailedPublishes.ts):
--   failure → +5 min → +30 min → +2 h → escalate (alert, surfaced in the
--   Scheduled panel). Retries go through the normal publishPost() path.
-- ============================================================================

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS publish_retry_count integer,
  ADD COLUMN IF NOT EXISTS publish_retry_at timestamptz;

-- Sweeper index: only failed posts with a due retry marker are picked up.
CREATE INDEX IF NOT EXISTS idx_posts_publish_retry_due
  ON posts (publish_retry_at)
  WHERE status = 'failed' AND publish_retry_at IS NOT NULL;
