-- ============================================================================
-- Migration: 001_initial_schema
-- Description: Core platform schema — multi-tenant SaaS with RLS, AI, social,
--              SEO, and subscription tables.
-- ============================================================================

-- 0. Extension ----------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. tenants
-- ============================================================================
CREATE TABLE IF NOT EXISTS tenants (
    id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name          TEXT,
    slug          TEXT UNIQUE,
    logo_url      TEXT,
    primary_color TEXT DEFAULT '#000000',
    custom_domain TEXT,
    billing_email TEXT,
    created_at    TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants (slug);

-- ============================================================================
-- 2. user_roles (replaces the auth.profiles pattern — lives in public schema)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.user_roles (
    user_id    UUID REFERENCES auth.users (id) ON DELETE CASCADE PRIMARY KEY,
    tenant_id  UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    role       TEXT CHECK (role IN (
                   'super_admin',
                   'agency_admin',
                   'agency_editor',
                   'client'
               )),
    client_id  UUID -- FK added after clients table is created below
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_user_roles_tenant    ON public.user_roles (tenant_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_client    ON public.user_roles (client_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role      ON public.user_roles (role);

-- ============================================================================
-- 3. clients
-- ============================================================================
CREATE TABLE IF NOT EXISTS clients (
    id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id   UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    name        TEXT,
    website     TEXT,
    notes       TEXT,
    created_at  TIMESTAMPTZ DEFAULT now()
);

-- FK from user_roles.client_id -> clients (added here because clients must exist first)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_user_roles_client'
    ) THEN
        ALTER TABLE public.user_roles
          ADD CONSTRAINT fk_user_roles_client
          FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE SET NULL;
    END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_clients_tenant ON clients (tenant_id);

-- ============================================================================
-- 4. tier_templates
-- ============================================================================
CREATE TABLE IF NOT EXISTS tier_templates (
    id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id   UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    name        TEXT,
    deliverables JSONB,
    is_default  BOOLEAN DEFAULT false,
    created_at  TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tier_templates_tenant    ON tier_templates (tenant_id);
CREATE INDEX IF NOT EXISTS idx_tier_templates_default   ON tier_templates (tenant_id, is_default);

-- ============================================================================
-- 5. ai_providers
-- ============================================================================
CREATE TABLE IF NOT EXISTS ai_providers (
    id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name        TEXT,
    base_url    TEXT,
    type        TEXT,
    created_at  TIMESTAMPTZ DEFAULT now()
);

-- ============================================================================
-- 6. ai_models
-- ============================================================================
CREATE TABLE IF NOT EXISTS ai_models (
    id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    provider_id      UUID REFERENCES ai_providers (id) ON DELETE CASCADE,
    model_identifier TEXT,
    supported_tasks  TEXT[] DEFAULT '{}'
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ai_models_provider ON ai_models (provider_id);

-- ============================================================================
-- 7. tenant_api_keys
-- NOTE: encrypted_key is stored as bytea. Keys MUST be encrypted at the
-- application layer (e.g. using pgsodium or libsodium sealed-box) before
-- insertion. pgcrypto is loaded above should you prefer server-side helpers.
-- ============================================================================
CREATE TABLE IF NOT EXISTS tenant_api_keys (
    id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id     UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    provider_id   UUID REFERENCES ai_providers (id) ON DELETE CASCADE,
    encrypted_key BYTEA,
    is_active     BOOLEAN DEFAULT true,
    created_at    TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tenant_api_keys_tenant   ON tenant_api_keys (tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_api_keys_provider ON tenant_api_keys (provider_id);

-- ============================================================================
-- 8. task_model_mappings
-- ============================================================================
CREATE TABLE IF NOT EXISTS task_model_mappings (
    id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id   UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    task        TEXT,
    model_id    UUID REFERENCES ai_models (id) ON DELETE CASCADE,
    client_id   UUID REFERENCES clients (id) ON DELETE CASCADE -- nullable
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_task_model_mappings_tenant  ON task_model_mappings (tenant_id);
CREATE INDEX IF NOT EXISTS idx_task_model_mappings_model   ON task_model_mappings (model_id);
CREATE INDEX IF NOT EXISTS idx_task_model_mappings_client  ON task_model_mappings (client_id);

-- ============================================================================
-- 9. social_accounts
-- ============================================================================
CREATE TABLE IF NOT EXISTS social_accounts (
    id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id       UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    platform        TEXT,
    account_name    TEXT,
    encrypted_token TEXT,
    created_at      TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_social_accounts_tenant   ON social_accounts (tenant_id);
CREATE INDEX IF NOT EXISTS idx_social_accounts_platform ON social_accounts (platform);

-- ============================================================================
-- 10. posts
-- ============================================================================
CREATE TABLE IF NOT EXISTS posts (
    id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id    UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    client_id    UUID REFERENCES clients (id) ON DELETE CASCADE,
    content      TEXT,
    media_urls   TEXT[] DEFAULT '{}',
    scheduled_at TIMESTAMPTZ,
    status       TEXT DEFAULT 'draft' CHECK (status IN (
                     'draft',
                     'pending_approval',
                     'approved',
                     'revision_requested',
                     'scheduled',
                     'published',
                     'failed'
                 )),
    created_by   UUID REFERENCES auth.users (id) ON DELETE SET NULL,
    approved_by  UUID REFERENCES auth.users (id) ON DELETE SET NULL,
    ai_generated BOOLEAN DEFAULT false,
    tier_level   INT
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_posts_tenant      ON posts (tenant_id);
CREATE INDEX IF NOT EXISTS idx_posts_client      ON posts (client_id);
CREATE INDEX IF NOT EXISTS idx_posts_status      ON posts (status);
CREATE INDEX IF NOT EXISTS idx_posts_scheduled   ON posts (scheduled_at) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_posts_created_by  ON posts (created_by);

-- ============================================================================
-- 11. post_platforms
-- ============================================================================
CREATE TABLE IF NOT EXISTS post_platforms (
    id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    post_id          UUID NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
    social_account_id UUID REFERENCES social_accounts (id) ON DELETE SET NULL,
    platform_post_id TEXT,
    status           TEXT DEFAULT 'queued'
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_post_platforms_post    ON post_platforms (post_id);
CREATE INDEX IF NOT EXISTS idx_post_platforms_account ON post_platforms (social_account_id);

-- ============================================================================
-- 12. comments
-- ============================================================================
CREATE TABLE IF NOT EXISTS comments (
    id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    post_id     UUID NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
    user_id     UUID REFERENCES auth.users (id) ON DELETE SET NULL,
    body        TEXT,
    created_at  TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_comments_post ON comments (post_id);

-- ============================================================================
-- 13. publishing_logs
-- ============================================================================
CREATE TABLE IF NOT EXISTS publishing_logs (
    id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    post_id      UUID,
    platform     TEXT,
    attempt_at   TIMESTAMPTZ DEFAULT now(),
    success      BOOLEAN,
    error_message TEXT
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_publishing_logs_post    ON publishing_logs (post_id);
CREATE INDEX IF NOT EXISTS idx_publishing_logs_attempt ON publishing_logs (attempt_at);

-- ============================================================================
-- 14. analytics_snapshots
-- ============================================================================
CREATE TABLE IF NOT EXISTS analytics_snapshots (
    id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    post_id     UUID NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
    platform    TEXT,
    likes       INT,
    comments    INT,
    shares      INT,
    impressions INT,
    reach       INT,
    fetched_at  TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_analytics_snapshots_post    ON analytics_snapshots (post_id);
CREATE INDEX IF NOT EXISTS idx_analytics_snapshots_fetched ON analytics_snapshots (fetched_at);

-- ============================================================================
-- 15. site_audits
-- ============================================================================
CREATE TABLE IF NOT EXISTS site_audits (
    id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id   UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    client_id   UUID REFERENCES clients (id) ON DELETE CASCADE,
    domain      TEXT,
    audit_json  JSONB,
    created_at  TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_site_audits_tenant ON site_audits (tenant_id);
CREATE INDEX IF NOT EXISTS idx_site_audits_client ON site_audits (client_id);

-- ============================================================================
-- 16. competitors
-- ============================================================================
CREATE TABLE IF NOT EXISTS competitors (
    id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id         UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    client_id         UUID REFERENCES clients (id) ON DELETE CASCADE,
    competitor_domain TEXT,
    data_json         JSONB,
    created_at        TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_competitors_tenant ON competitors (tenant_id);
CREATE INDEX IF NOT EXISTS idx_competitors_client ON competitors (client_id);

-- ============================================================================
-- 17. seo_campaigns
-- ============================================================================
CREATE TABLE IF NOT EXISTS seo_campaigns (
    id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id    UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    client_id    UUID REFERENCES clients (id) ON DELETE CASCADE,
    tier_name    TEXT,
    tier_level   INT,
    campaign_json JSONB,
    status       TEXT DEFAULT 'proposed' CHECK (status IN (
                     'proposed',
                     'approved',
                     'deployed',
                     'archived'
                 )),
    created_at   TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_seo_campaigns_tenant ON seo_campaigns (tenant_id);
CREATE INDEX IF NOT EXISTS idx_seo_campaigns_client ON seo_campaigns (client_id);
CREATE INDEX IF NOT EXISTS idx_seo_campaigns_status ON seo_campaigns (status);

-- ============================================================================
-- 18. subscriptions
-- ============================================================================
CREATE TABLE IF NOT EXISTS subscriptions (
    id                     UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id              UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    plan_id                TEXT,
    stripe_subscription_id TEXT,
    status                 TEXT,
    created_at             TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant    ON subscriptions (tenant_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_id ON subscriptions (stripe_subscription_id);

-- ============================================================================
-- ROW-LEVEL SECURITY
-- ============================================================================

-- Policy helper: every multi-tenant table that owns a tenant_id column gets a
-- blanket "tenant_isolation" policy that compares tenant_id to the JWT claim
-- 'tenant_id' stored in the user's session token (set at login / sign-up).

-- Tables that do NOT have a direct tenant_id column (ai_providers, ai_models,
-- post_platforms, comments, publishing_logs, analytics_snapshots) are scoped
-- at the application layer via joins or service-layer checks.

-- tenants -------------------------------------------------------------------
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY "tenant_isolation" ON tenants
        FOR ALL
        USING (id = (auth.jwt() ->> 'tenant_id')::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- user_roles ----------------------------------------------------------------
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY "tenant_isolation" ON public.user_roles
        FOR ALL
        USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- clients -------------------------------------------------------------------
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY "tenant_isolation" ON clients
        FOR ALL
        USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- tier_templates ------------------------------------------------------------
ALTER TABLE tier_templates ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY "tenant_isolation" ON tier_templates
        FOR ALL
        USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- tenant_api_keys -----------------------------------------------------------
ALTER TABLE tenant_api_keys ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY "tenant_isolation" ON tenant_api_keys
        FOR ALL
        USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- task_model_mappings -------------------------------------------------------
ALTER TABLE task_model_mappings ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY "tenant_isolation" ON task_model_mappings
        FOR ALL
        USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- social_accounts -----------------------------------------------------------
ALTER TABLE social_accounts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY "tenant_isolation" ON social_accounts
        FOR ALL
        USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- posts ---------------------------------------------------------------------
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY "tenant_isolation" ON posts
        FOR ALL
        USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- site_audits ---------------------------------------------------------------
ALTER TABLE site_audits ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY "tenant_isolation" ON site_audits
        FOR ALL
        USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- competitors ---------------------------------------------------------------
ALTER TABLE competitors ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY "tenant_isolation" ON competitors
        FOR ALL
        USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- seo_campaigns -------------------------------------------------------------
ALTER TABLE seo_campaigns ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY "tenant_isolation" ON seo_campaigns
        FOR ALL
        USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- subscriptions -------------------------------------------------------------
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY "tenant_isolation" ON subscriptions
        FOR ALL
        USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- NOTE: After creating this migration, run:
--   supabase db push
-- or (if using local development):
--   supabase migration up
-- to apply the schema to your linked Supabase project.
-- ============================================================================