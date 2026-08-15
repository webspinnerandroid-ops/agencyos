-- ============================================================================
-- Migration: 025_seo_score_and_site_settings
--
-- 1. posts: denormalized on-page SEO score columns so list
--    queries never touch the content JSONB blob.
-- 2. site_settings: a single global row (id = 1) for platform-level settings
--    (landing hero media mode / video URL).
-- 3. delete_tenant_data(): SECURITY DEFINER helper that permanently removes
--    every row of every table that has a tenant_id column, then the tenant
--    itself. Auth users are cleaned up app-side (auth.admin.deleteUser) so
--    users who also belong to other tenants are never touched.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. posts SEO score columns + trigger
-- ---------------------------------------------------------------------------
ALTER TABLE posts ADD COLUMN IF NOT EXISTS seo_score  INTEGER;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS seo_checks JSONB;
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS alt_text TEXT;

-- Keep the columns in sync whenever content (which carries content->'seo')
-- is written by any path (generate-content, campaign deployment, seeds).
CREATE OR REPLACE FUNCTION sync_post_seo_columns() RETURNS trigger AS $$
BEGIN
  IF NEW.content IS NOT NULL AND NEW.content ? 'seo' THEN
    NEW.seo_score  := (NEW.content->'seo'->>'score')::int;
    NEW.seo_checks := NEW.content->'seo'->'checks';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_post_seo_columns ON posts;
CREATE TRIGGER trg_sync_post_seo_columns
  BEFORE INSERT OR UPDATE OF content ON posts
  FOR EACH ROW EXECUTE FUNCTION sync_post_seo_columns();

-- Backfill existing rows that already carry content->'seo' (safe, idempotent).
UPDATE posts
SET seo_score  = (content->'seo'->>'score')::int,
    seo_checks = content->'seo'->'checks'
WHERE content ? 'seo' AND (seo_score IS NULL);

-- ---------------------------------------------------------------------------
-- 2. site_settings — global platform settings (single row, id = 1)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS site_settings (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  hero_mode       TEXT NOT NULL DEFAULT 'slideshow',   -- 'slideshow' | 'video'
  hero_video_url  TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO site_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Super admins manage it; everyone can read (the public landing needs it).
ALTER TABLE site_settings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "site_settings_read" ON site_settings
    FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "site_settings_write" ON site_settings
    FOR ALL USING (auth.jwt() ->> 'role' = 'super_admin')
    WITH CHECK (auth.jwt() ->> 'role' = 'super_admin');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT SELECT ON site_settings TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. delete_tenant_data — permanently remove a tenant and everything under it
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION delete_tenant_data(p_tenant_id UUID)
RETURNS void AS $$
DECLARE
  tbl TEXT;
  col TEXT;
BEGIN
  -- Every table that carries a tenant_id column, in dependency-safe order.
  FOR tbl IN
    SELECT table_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'tenant_id'
  LOOP
    EXECUTE format('DELETE FROM public.%I WHERE tenant_id = %L', tbl, p_tenant_id);
  END LOOP;

  -- user_roles links users to tenants; the tenant row itself goes last.
  DELETE FROM public.user_roles WHERE tenant_id = p_tenant_id;
  DELETE FROM public.tenants WHERE id = p_tenant_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION delete_tenant_data(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION delete_tenant_data(UUID) TO service_role;
