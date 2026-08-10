-- ============================================================================
-- Migration: 006_workspaces_kb_brand
-- Description: Workspaces, knowledgebase (folders + items), brand profiles
-- ============================================================================

-- 1. workspaces ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workspaces (
    id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id   UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    slug        TEXT NOT NULL,
    description TEXT,
    logo_url    TEXT,
    is_default  BOOLEAN DEFAULT false,
    created_at  TIMESTAMPTZ DEFAULT now(),
    UNIQUE(tenant_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_workspaces_tenant ON workspaces (tenant_id);
CREATE INDEX IF NOT EXISTS idx_workspaces_slug ON workspaces (tenant_id, slug);

ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY "tenant_isolation" ON workspaces
        FOR ALL USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. Add workspace_id to existing tables ---------------------------------------
ALTER TABLE clients ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces (id) ON DELETE SET NULL;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces (id) ON DELETE SET NULL;
ALTER TABLE seo_campaigns ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces (id) ON DELETE SET NULL;
ALTER TABLE site_audits ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces (id) ON DELETE SET NULL;
ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces (id) ON DELETE SET NULL;
ALTER TABLE blog_platforms ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces (id) ON DELETE SET NULL;
ALTER TABLE google_business_profiles ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces (id) ON DELETE SET NULL;
ALTER TABLE task_model_mappings ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces (id) ON DELETE SET NULL;

-- Index workspace_id columns
CREATE INDEX IF NOT EXISTS idx_clients_workspace ON clients (workspace_id);
CREATE INDEX IF NOT EXISTS idx_posts_workspace ON posts (workspace_id);
CREATE INDEX IF NOT EXISTS idx_seo_campaigns_workspace ON seo_campaigns (workspace_id);
CREATE INDEX IF NOT EXISTS idx_site_audits_workspace ON site_audits (workspace_id);
CREATE INDEX IF NOT EXISTS idx_social_accounts_workspace ON social_accounts (workspace_id);
CREATE INDEX IF NOT EXISTS idx_blog_platforms_workspace ON blog_platforms (workspace_id);
CREATE INDEX IF NOT EXISTS idx_gbp_workspace ON google_business_profiles (workspace_id);

-- 3. knowledgebase_folders -----------------------------------------------------
CREATE TABLE IF NOT EXISTS knowledgebase_folders (
    id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id     UUID NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    tenant_id        UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    parent_folder_id UUID REFERENCES knowledgebase_folders (id) ON DELETE CASCADE,
    name             TEXT NOT NULL,
    slug             TEXT NOT NULL,
    created_at       TIMESTAMPTZ DEFAULT now(),
    UNIQUE(workspace_id, parent_folder_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_kb_folders_workspace ON knowledgebase_folders (workspace_id);
CREATE INDEX IF NOT EXISTS idx_kb_folders_parent ON knowledgebase_folders (parent_folder_id);

ALTER TABLE knowledgebase_folders ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY "tenant_isolation" ON knowledgebase_folders
        FOR ALL USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 4. knowledgebase_items -------------------------------------------------------
CREATE TABLE IF NOT EXISTS knowledgebase_items (
    id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    folder_id           UUID REFERENCES knowledgebase_folders (id) ON DELETE SET NULL,
    workspace_id        UUID NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    tenant_id           UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    name                TEXT NOT NULL,
    type                TEXT NOT NULL CHECK (type IN ('url', 'doc', 'image', 'video', 'text')),
    source_url          TEXT,
    original_filename   TEXT,
    storage_path        TEXT,
    mime_type           TEXT,
    file_size           BIGINT,
    scraped_text        TEXT,
    extracted_metadata  JSONB DEFAULT '{}',
    status              TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'scraping', 'extracting', 'ready', 'error')),
    error_message       TEXT,
    created_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kb_items_workspace ON knowledgebase_items (workspace_id);
CREATE INDEX IF NOT EXISTS idx_kb_items_folder ON knowledgebase_items (folder_id);
CREATE INDEX IF NOT EXISTS idx_kb_items_type ON knowledgebase_items (type);
CREATE INDEX IF NOT EXISTS idx_kb_items_status ON knowledgebase_items (status);

ALTER TABLE knowledgebase_items ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY "tenant_isolation" ON knowledgebase_items
        FOR ALL USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 5. brand_profiles ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS brand_profiles (
    id                       UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id             UUID NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    tenant_id                UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    name                     TEXT NOT NULL,
    is_default               BOOLEAN DEFAULT false,

    -- Voice & Persona
    brand_voice              TEXT,
    tone_of_voice            TEXT,
    persona_description      TEXT,
    avoid_words              TEXT[] DEFAULT '{}',
    prefer_words             TEXT[] DEFAULT '{}',

    -- Content Rules
    min_word_count           INTEGER DEFAULT 300,
    max_word_count           INTEGER DEFAULT 2500,
    target_keyword_density   DECIMAL(3,1) DEFAULT 1.5,
    keyword_discovery_rules  TEXT,

    -- Formatting Rules
    heading_style            TEXT DEFAULT 'sentence_case',
    paragraph_structure      TEXT,
    required_sections        TEXT[] DEFAULT '{}',
    formatting_instructions  TEXT,

    -- SEO Rules
    meta_description_length  INTEGER DEFAULT 160,
    slug_format              TEXT DEFAULT 'hyphenated',
    internal_linking_rules   TEXT,
    image_alt_text_rules     TEXT,

    -- Platform overrides
    platform_overrides       JSONB DEFAULT '{}',
    custom_instructions     TEXT,

    created_at               TIMESTAMPTZ DEFAULT now(),
    updated_at               TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brand_profiles_workspace ON brand_profiles (workspace_id);

ALTER TABLE brand_profiles ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY "tenant_isolation" ON brand_profiles
        FOR ALL USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 6. License limits metadata column --------------------------------------------
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS limits JSONB DEFAULT '{}';

-- 7. Extension for PDF text extraction if not loaded ---------------------------
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- 8. Full-text search index on knowledgebase_items scraped_text ----------------
CREATE INDEX IF NOT EXISTS idx_kb_items_text_search ON knowledgebase_items USING gin (to_tsvector('english', COALESCE(scraped_text, '')));