-- 086 — auto-save generated assets to the attached Google Drive folder
-- Per-workspace flag on the Drive connection. When true, every newly
-- generated image/brand asset is mirrored into the attached folder without
-- needing a per-asset click.

ALTER TABLE tenant_connections
    ADD COLUMN IF NOT EXISTS auto_save_to_drive BOOLEAN NOT NULL DEFAULT FALSE;
