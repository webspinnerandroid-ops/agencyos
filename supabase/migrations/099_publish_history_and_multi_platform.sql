-- ============================================================================
-- Migration: 099_publish_history_and_multi_platform
-- Description: Per-site publish history for connected-sites publishing
--              (WordPress, Ghost, Medium, Webflow, built-in CMS).
-- ============================================================================

-- publishing_logs gains the connected site's name and the live URL of the
-- published post/page so the dashboard and Posts list can show "published to
-- <site>" links. Both are null for the legacy platform-level logs (which only
-- recorded platform + success), so old rows keep working.
ALTER TABLE publishing_logs ADD COLUMN IF NOT EXISTS site_name TEXT;
ALTER TABLE publishing_logs ADD COLUMN IF NOT EXISTS target_url TEXT;

-- Faster lookups for "latest successful publish per post" on the dashboard
-- and Posts list.
CREATE INDEX IF NOT EXISTS idx_publishing_logs_post_success
    ON publishing_logs (post_id, success, attempt_at DESC);