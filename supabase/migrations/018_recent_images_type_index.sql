-- ============================================================================
-- Migration: 018_recent_images_type_index
-- Description:
--   The dashboard "Recent Images" + /api/generate-image/recent queries filter:
--     media_assets WHERE tenant_id = X AND type = 'image' AND status = 'completed'
--                     AND workspace_id = Y ORDER BY created_at DESC LIMIT 20
--   The existing index (tenant_id, workspace_id, status, created_at) does not
--   include `type`, so Postgres cannot fully narrow the scan. Add a
--   type-aware composite index covering the exact query shape.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_media_assets_recent_images
    ON media_assets (tenant_id, workspace_id, type, status, created_at DESC);