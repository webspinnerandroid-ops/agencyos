-- 051 — draft preview tokens + custom domain mapping
-- preview_token lets an unpublished page be reviewed via /site/<slug>?preview=<token>.
-- site_domains maps a custom domain (client.com) to a site slug served by the
-- platform's /site/<slug> renderer.

ALTER TABLE site_pages ADD COLUMN IF NOT EXISTS preview_token UUID;

CREATE TABLE IF NOT EXISTS site_domains (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    domain     TEXT NOT NULL UNIQUE,
    site_slug  TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_site_domains_tenant ON site_domains (tenant_id);
ALTER TABLE site_domains ENABLE ROW LEVEL SECURITY;
CREATE POLICY "no_direct_access" ON site_domains FOR ALL USING (false);
