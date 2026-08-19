-- 087 — per-asset Google Drive sync status
-- The Asset Library shows which files already mirrored to the workspace's
-- attached Drive folder and which failed, instead of guessing from a toast.
ALTER TABLE media_assets
    ADD COLUMN IF NOT EXISTS drive_synced_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS drive_file_id   TEXT,
    ADD COLUMN IF NOT EXISTS drive_error     TEXT;

CREATE INDEX IF NOT EXISTS idx_media_assets_drive_synced
    ON media_assets (drive_synced_at)
    WHERE drive_synced_at IS NULL AND status = 'completed' AND url IS NOT NULL;
