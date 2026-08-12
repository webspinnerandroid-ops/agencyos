-- ============================================================================
-- Migration: 021_posts_denorm
-- Description:
--   List queries (dashboard "Recent Content", the All Content page) used
--   PostgREST JSON-path projections (content->title, content->type, ...).
--   Posts' content JSONB contains megabytes of base64 image data, so every
--   extraction forced Postgres to scan the whole blob per row — a 112-row
--   list took 4-10s and intermittently hit PostgREST's statement timeout,
--   which silently emptied the list.
--
--   This migration denormalizes the fields lists need into real columns,
--   backfills existing rows from the content JSONB, and adds a trigger so
--   every future insert/update (generate-content, SEO campaign deployment)
--   keeps them in sync automatically.
-- ============================================================================

-- 1. Columns
ALTER TABLE posts ADD COLUMN IF NOT EXISTS title    TEXT;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS type     TEXT;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS platform TEXT;

-- 2. Backfill existing rows (idempotent)
UPDATE posts SET
  title    = COALESCE(content->>'title', LEFT(content->>'caption', 80), 'Untitled'),
  type     = COALESCE(content->>'type', 'blog'),
  platform = COALESCE(content->>'platform', '')
WHERE title IS NULL OR type IS NULL OR platform IS NULL;

-- 3. Trigger: keep the columns in sync on every insert/update of content.
--    Covers every write path (generate-content, deployCampaign, seeds),
--    so new posts never need the app to remember the denormalized fields.
CREATE OR REPLACE FUNCTION sync_post_denorm_columns() RETURNS trigger AS $$
BEGIN
  IF NEW.content IS NOT NULL THEN
    NEW.title    := COALESCE(
                      NEW.content->>'title',
                      LEFT(NEW.content->>'caption', 80),
                      NEW.title,
                      'Untitled'
                    );
    NEW.type     := COALESCE(NEW.content->>'type', NEW.type, 'blog');
    NEW.platform := COALESCE(NEW.content->>'platform', NEW.platform, '');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_posts_sync_denorm ON posts;
CREATE TRIGGER trg_posts_sync_denorm
  BEFORE INSERT OR UPDATE OF content ON posts
  FOR EACH ROW EXECUTE FUNCTION sync_post_denorm_columns();

-- 4. Index for list ordering (created_at index already exists from 020).
CREATE INDEX IF NOT EXISTS idx_posts_tenant_type ON posts (tenant_id, type);
