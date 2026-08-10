-- ============================================================================
-- Migration: 016_workspace_media_and_indexes
-- Description:
--   1. Add workspace_id to media_assets (missing from 012_flux) so generated
--      images can be scoped per workspace.
--   2. Backfill legacy NULL workspace rows (clients, posts, media_assets,
--      seo_campaigns) into the tenant's default workspace so they remain
--      visible after workspace scoping is enforced.
--   3. Composite indexes for dashboard/SEO query speed.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. media_assets.workspace_id
-- ----------------------------------------------------------------------------
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_media_assets_workspace ON media_assets (workspace_id);

-- ----------------------------------------------------------------------------
-- 2. Backfill legacy NULL workspace rows into the default workspace
--    (only when a default workspace exists for the tenant)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  w RECORD;
BEGIN
  FOR w IN
    SELECT id
    FROM workspaces
    WHERE is_default = true
  LOOP
    -- media_assets
    UPDATE media_assets
    SET workspace_id = w.id
    WHERE tenant_id = (SELECT tenant_id FROM workspaces WHERE id = w.id)
      AND workspace_id IS NULL;

    -- clients
    UPDATE clients
    SET workspace_id = w.id
    WHERE tenant_id = (SELECT tenant_id FROM workspaces WHERE id = w.id)
      AND workspace_id IS NULL;

    -- posts
    UPDATE posts
    SET workspace_id = w.id
    WHERE tenant_id = (SELECT tenant_id FROM workspaces WHERE id = w.id)
      AND workspace_id IS NULL;

    -- seo_campaigns
    UPDATE seo_campaigns
    SET workspace_id = w.id
    WHERE tenant_id = (SELECT tenant_id FROM workspaces WHERE id = w.id)
      AND workspace_id IS NULL;
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 3. Composite indexes for dashboard / SEO queries
--    Dashboard queries filter: tenant_id + client_id + status + created_at
-- ----------------------------------------------------------------------------
-- posts has NO created_at column — order by scheduled_at (dashboard query pattern)
CREATE INDEX IF NOT EXISTS idx_posts_tenant_client_status ON posts (tenant_id, client_id, status, scheduled_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_tenant_scheduled    ON posts (tenant_id, scheduled_at DESC);

CREATE INDEX IF NOT EXISTS idx_media_assets_tenant_client_status_created
    ON media_assets (tenant_id, client_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_assets_tenant_workspace_status_created
    ON media_assets (tenant_id, workspace_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_seo_campaigns_tenant_client_created
    ON seo_campaigns (tenant_id, client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_seo_campaigns_tenant_workspace_created
    ON seo_campaigns (tenant_id, workspace_id, created_at DESC);