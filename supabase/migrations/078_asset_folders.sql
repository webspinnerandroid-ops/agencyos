-- ============================================================================
-- Migration: 078_asset_folders
-- Description:
--   Workspace asset library. Every generated asset (images, videos, voice,
--   brand & vector design) lives inside a workspace; this adds user-created
--   folders so a client's assets can be organized (e.g. "Logo concepts",
--   "Q3 campaign", "Website mockups"). Also adds media_assets.task so Brand
--   Design results are separable from plain image generations.
-- ============================================================================

-- 1. asset_folders — user-created folders inside a workspace
CREATE TABLE IF NOT EXISTS asset_folders (
    id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id     UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    workspace_id  UUID REFERENCES workspaces (id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    -- Which asset kind the folder is meant to hold. "content" is reserved for
    -- blog/social posts (stored in posts, not media_assets) and is only used
    -- by the dashboard library view, not by media_assets rows.
    kind          TEXT NOT NULL DEFAULT 'image' CHECK (kind IN ('image','video','voice','brand','content')),
    parent_id     UUID REFERENCES asset_folders (id) ON DELETE CASCADE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_asset_folders_tenant     ON asset_folders (tenant_id);
CREATE INDEX IF NOT EXISTS idx_asset_folders_workspace  ON asset_folders (workspace_id);
CREATE INDEX IF NOT EXISTS idx_asset_folders_kind       ON asset_folders (kind);

ALTER TABLE asset_folders ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY "tenant_isolation" ON asset_folders
        FOR ALL USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. media_assets.folder_id — which folder (if any) an asset sits in
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES asset_folders (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_media_assets_folder ON media_assets (folder_id);

-- 3. media_assets.task — generation kind (brand_design vs image_generation)
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS task TEXT;
CREATE INDEX IF NOT EXISTS idx_media_assets_task ON media_assets (task);
