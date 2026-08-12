-- Migration: 036_site_settings_and_outreach
--
-- Powers: sitewide header/footer + global stylesheets (theme presets + custom
-- CSS), CMS page kinds & categories (page / blog archive / blog post), the
-- guest-post outreach tracker (discovered blogs with scoring + PR metrics),
-- and the weekly Reddit/LinkedIn/Quora opportunity finder.

-- ---------------------------------------------------------------------------
-- Sitewide CMS settings (per tenant + workspace): header/footer blocks,
-- global stylesheet, and a theme preset applied to every public /site page.
-- Named cms_site_settings because `site_settings` is taken by the platform
-- landing-page hero config (migration 025).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cms_site_settings (
    id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id      UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    workspace_id   UUID REFERENCES workspaces (id) ON DELETE CASCADE,
    site_name      TEXT NOT NULL DEFAULT 'My Site',
    tagline        TEXT,
    header_blocks  JSONB NOT NULL DEFAULT '[]',
    footer_blocks  JSONB NOT NULL DEFAULT '[]',
    global_css     TEXT NOT NULL DEFAULT '',
    theme_preset   TEXT NOT NULL DEFAULT 'clean',  -- 'clean' | 'dark' | 'corporate' | 'bold'
    created_at     TIMESTAMPTZ DEFAULT now(),
    updated_at     TIMESTAMPTZ DEFAULT now(),
    UNIQUE (tenant_id, workspace_id)
);

-- ---------------------------------------------------------------------------
-- Page kinds & categories for the CMS content model.
--   kind: 'page' (main content) | 'blog_archive' (styled blog listing) |
--         'blog_post' (a single article)
--   category: e.g. 'services' | 'about' | 'contact' for pages;
--             'company news' | 'community news' for posts.
-- ---------------------------------------------------------------------------
ALTER TABLE site_pages ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'page';
ALTER TABLE site_pages ADD COLUMN IF NOT EXISTS category TEXT;
CREATE INDEX IF NOT EXISTS idx_site_pages_kind ON site_pages (tenant_id, kind);

-- ---------------------------------------------------------------------------
-- Guest-post outreach tracker.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS outreach_targets (
    id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id         UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    workspace_id      UUID REFERENCES workspaces (id) ON DELETE CASCADE,
    client_id         UUID REFERENCES clients (id) ON DELETE SET NULL,
    blog_name         TEXT,
    blog_url          TEXT NOT NULL,
    contact_email     TEXT,
    relevance_score   INT NOT NULL DEFAULT 0,   -- 0-100 AI relevance to the niche
    authority_score   INT NOT NULL DEFAULT 0,   -- 0-100 page-rank-like metric (DA/PR style)
    traffic_estimate  TEXT,
    notes             TEXT,
    status            TEXT NOT NULL DEFAULT 'discovered', -- discovered|pitched|accepted|published|rejected
    pitch             TEXT,
    pitch_sent_at     TIMESTAMPTZ,
    created_at        TIMESTAMPTZ DEFAULT now(),
    UNIQUE (tenant_id, blog_url)
);
CREATE INDEX IF NOT EXISTS idx_outreach_tenant ON outreach_targets (tenant_id, status);

-- ---------------------------------------------------------------------------
-- Weekly content opportunities (Reddit / LinkedIn / Quora).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS content_opportunities (
    id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id         UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    workspace_id      UUID REFERENCES workspaces (id) ON DELETE CASCADE,
    client_id         UUID REFERENCES clients (id) ON DELETE SET NULL,
    platform          TEXT NOT NULL,             -- reddit | linkedin | quora
    title             TEXT,
    url               TEXT,
    snippet           TEXT,
    relevance_score   INT NOT NULL DEFAULT 0,
    recommendation    TEXT,
    status            TEXT NOT NULL DEFAULT 'new', -- new|drafted|posted|dismissed
    week_start        DATE,
    created_at        TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_opportunities_tenant ON content_opportunities (tenant_id, status);

ALTER TABLE cms_site_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE outreach_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_opportunities ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Generic per-tenant settings (JSONB key-value) — e.g. the deploy/SSH config
-- stored encrypted, and any future feature flags. Service-role only.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenant_settings (
    tenant_id    UUID PRIMARY KEY REFERENCES tenants (id) ON DELETE CASCADE,
    settings     JSONB NOT NULL DEFAULT '{}',
    updated_at   TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE tenant_settings ENABLE ROW LEVEL SECURITY;
