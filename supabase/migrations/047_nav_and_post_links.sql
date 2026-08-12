-- 047 — analytics post URLs, per-tenant app nav config, and CMS site menu
-- ============================================================================

-- 1. Post platform links: canonical URL of the published post on the social
--    platform, captured when the publisher posts (best-effort; the platform
--    post id remains the fallback for URL derivation).
ALTER TABLE post_platforms ADD COLUMN IF NOT EXISTS platform_post_url TEXT;

-- 2. Per-tenant navigation configuration for the Agency OS app itself.
--    Sections hold the ordered nav structure the super admin (or tenant)
--    customizes: [{ label, items: [{ href, label }] }]. Absent row = the
--    built-in default navigation.
CREATE TABLE IF NOT EXISTS nav_config (
    tenant_id  UUID PRIMARY KEY REFERENCES tenants (id) ON DELETE CASCADE,
    sections   JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_nav_config_tenant ON nav_config (tenant_id);
ALTER TABLE nav_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "no_direct_access" ON nav_config FOR ALL USING (false);

-- 3. CMS site menu: ordered navigation for sites built with the Web Builder.
--    Stored on cms_site_settings alongside header/footer blocks:
--    [{ label, href }] — href is a /site/<slug> page or an external URL.
ALTER TABLE cms_site_settings ADD COLUMN IF NOT EXISTS site_nav JSONB;
