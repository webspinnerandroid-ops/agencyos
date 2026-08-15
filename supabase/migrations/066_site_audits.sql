-- 066 — saved site audits (URL / text content analyzer runs).
-- The `site_audits` table already exists from 001 (legacy client-domain
-- audit_json rows, currently unused). This migration EXTENDS it with the
-- analyzer-run columns so every URL/text audit persists with its full
-- SEO/AEO/GEO scores + per-check breakdown, enabling the monitored-sites
-- dashboard, score history (previous vs recent) and re-audit-after-edits.

ALTER TABLE site_audits
    ADD COLUMN IF NOT EXISTS mode        TEXT NOT NULL DEFAULT 'url' CHECK (mode IN ('url', 'text')),
    ADD COLUMN IF NOT EXISTS url         TEXT,
    ADD COLUMN IF NOT EXISTS title       TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS keyword     TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS seo_score   INTEGER,
    ADD COLUMN IF NOT EXISTS aeo_score   INTEGER,
    ADD COLUMN IF NOT EXISTS geo_score   INTEGER,
    ADD COLUMN IF NOT EXISTS word_count  INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS issues      INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS checks_json JSONB,
    ADD COLUMN IF NOT EXISTS fetched     BOOLEAN,
    ADD COLUMN IF NOT EXISTS fetch_error TEXT;

CREATE INDEX IF NOT EXISTS idx_site_audits_tenant_created
    ON site_audits (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_site_audits_tenant_url
    ON site_audits (tenant_id, url, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_site_audits_workspace
    ON site_audits (workspace_id, created_at DESC);

ALTER TABLE site_audits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "no_direct_access" ON site_audits;
CREATE POLICY "no_direct_access" ON site_audits FOR ALL USING (false);
