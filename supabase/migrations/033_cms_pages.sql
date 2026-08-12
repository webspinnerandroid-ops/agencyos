-- Migration: 033_cms_pages
--
-- Visual page builder (CMS). Pages live per tenant + workspace; each page
-- holds an ordered array of blocks (text, image, or AI-built custom widgets
-- like forms / maps / embeds). Published pages render publicly at /site/<slug>.
-- AI-built form widgets POST to /api/cms/forms, which stores submissions here.

CREATE TABLE IF NOT EXISTS site_pages (
    id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id      UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    workspace_id   UUID REFERENCES workspaces (id) ON DELETE CASCADE,
    client_id      UUID REFERENCES clients (id) ON DELETE SET NULL,
    title          TEXT NOT NULL DEFAULT 'Untitled Page',
    slug           TEXT NOT NULL,
    blocks         JSONB NOT NULL DEFAULT '[]',
    is_published   BOOLEAN NOT NULL DEFAULT false,
    published_at   TIMESTAMPTZ,
    created_at     TIMESTAMPTZ DEFAULT now(),
    updated_at     TIMESTAMPTZ DEFAULT now(),
    UNIQUE (tenant_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_site_pages_tenant ON site_pages (tenant_id);
CREATE INDEX IF NOT EXISTS idx_site_pages_workspace ON site_pages (workspace_id);

CREATE TABLE IF NOT EXISTS cms_form_submissions (
    id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id      UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    page_id        UUID REFERENCES site_pages (id) ON DELETE CASCADE,
    block_id       TEXT,
    fields         JSONB NOT NULL DEFAULT '{}',
    submitted_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cms_submissions_tenant
    ON cms_form_submissions (tenant_id, submitted_at DESC);

-- Row-level security: keep admin-only via service role like the rest of the
-- platform's tenant tables (no anon access).
ALTER TABLE site_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE cms_form_submissions ENABLE ROW LEVEL SECURITY;
