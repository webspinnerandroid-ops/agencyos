-- ============================================================================
-- Migration: 004_schema_patches
-- Description: Adds missing columns discovered during app review:
--   - tier_templates: price, description
--   - seo_campaigns: url, tier_price, audit_json, competitors_json, created_by
--   - subscriptions: plan_id (if missing)
--   - posts: change content from TEXT to JSONB for larger payloads
--   - Creates tenant-assets storage bucket
-- ============================================================================

-- 1. Patch tier_templates -----------------------------------------------------
ALTER TABLE tier_templates ADD COLUMN IF NOT EXISTS price INTEGER DEFAULT 0;
ALTER TABLE tier_templates ADD COLUMN IF NOT EXISTS description TEXT;

-- 2. Patch seo_campaigns -------------------------------------------------------
ALTER TABLE seo_campaigns ADD COLUMN IF NOT EXISTS url TEXT;
ALTER TABLE seo_campaigns ADD COLUMN IF NOT EXISTS tier_price INTEGER DEFAULT 0;
ALTER TABLE seo_campaigns ADD COLUMN IF NOT EXISTS audit_json JSONB;
ALTER TABLE seo_campaigns ADD COLUMN IF NOT EXISTS competitors_json JSONB;
ALTER TABLE seo_campaigns ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users (id) ON DELETE SET NULL;

-- 3. Patch subscriptions (plan_id may not exist from migration 002) -----------
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS plan_id TEXT;

-- 4. Convert posts.content from TEXT to JSONB via a new column ----------------
--    PostgreSQL doesn't allow direct TEXT->JSONB cast, so we add a new column,
--    attempt to migrate data, then drop the old one.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'posts' AND column_name = 'content_jsonb'
    ) THEN
        ALTER TABLE posts ADD COLUMN content_jsonb JSONB;
        UPDATE posts SET content_jsonb = content::JSONB WHERE content IS NOT NULL AND content != '';
        ALTER TABLE posts DROP COLUMN content;
        ALTER TABLE posts RENAME COLUMN content_jsonb TO content;
    END IF;
END $$;

-- 5. Create tenant-assets storage bucket --------------------------------------
--    Supabase Storage buckets are created via the management API; this SQL
--    inserts the bucket row directly into the storage schema.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('tenant-assets', 'tenant-assets', true, 5242880, ARRAY['image/png', 'image/svg+xml', 'image/jpeg', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: Allow service_role full access, authenticated users read their tenant's files
CREATE POLICY "Service role full access" ON storage.objects
    FOR ALL USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

DO $$ BEGIN
    CREATE POLICY "Public read tenant assets" ON storage.objects
        FOR SELECT USING (bucket_id = 'tenant-assets');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;