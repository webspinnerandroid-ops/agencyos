-- 053 — IndexNow auto-indexer keys
-- One key per host (platform domain + mapped CMS custom domains). The key
-- file is served at https://<host>/<key>.txt so search engines can verify.
CREATE TABLE IF NOT EXISTS indexnow_keys (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    host       TEXT NOT NULL UNIQUE,
    key        TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE indexnow_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "no_direct_access" ON indexnow_keys FOR ALL USING (false);
