-- 088 — per-item Google Drive sync status for the knowledgebase
-- Mirrors the media_assets columns from 087 so KB exports can show the
-- same "Drive" badge + "Retry sync" affordance instead of fire-and-forget.
ALTER TABLE knowledgebase_items
    ADD COLUMN IF NOT EXISTS drive_synced_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS drive_file_id   TEXT,
    ADD COLUMN IF NOT EXISTS drive_error     TEXT;

CREATE INDEX IF NOT EXISTS idx_kb_items_drive_synced
    ON knowledgebase_items (drive_synced_at)
    WHERE drive_synced_at IS NULL AND storage_path IS NOT NULL AND status = 'ready';
