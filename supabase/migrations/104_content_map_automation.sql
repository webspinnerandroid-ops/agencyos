-- ============================================================================
-- Migration: 104_content_map_automation
--
-- Supports the content-map automation pipeline:
--
-- 1. social_accounts.spec_overrides (JSONB, nullable)
--    Per-account overrides of the per-platform caption specs
--    (src/lib/ai/seo-prompts.ts PLATFORM_SPECS) — custom char limits,
--    hashtag counts, image sizes for a SPECIFIC account, e.g. a client
--    whose X account is verified (longer posts) or whose brand guide caps
--    hashtags at 3. Shape (all keys optional):
--      { "charLimit"?: number, "hashtagCount"?: number, "imageSize"?: string }
--    Editable in Settings → Social accounts.
--
-- 2. content_map_items.auto_publish (TEXT, nullable)
--    Per-row automation target, set by the CSV ("Auto Publish" column) or the
--    row editor. NULL = manual (draft only, current behavior). "wordpress" =
--    after a gate-cleared generation, the draft is auto-approved and handed
--    to the WordPress scheduler for its planned publish date. Future values
--    (e.g. "cms") ride the same seam.
--
-- No backfills needed: both columns are nullable and default to the current
-- manual behavior.
-- ============================================================================

ALTER TABLE social_accounts
  ADD COLUMN IF NOT EXISTS spec_overrides JSONB;

ALTER TABLE content_map_items
  ADD COLUMN IF NOT EXISTS auto_publish TEXT;
