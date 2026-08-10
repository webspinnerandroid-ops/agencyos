-- ============================================================================
-- Migration: 005_blog_and_gbp
-- Description: Tables for blog platform connections and Google Business Profile
-- ============================================================================

-- 1. blog_platforms -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS blog_platforms (
    id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id             UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    platform_type         TEXT NOT NULL,
    site_url              TEXT NOT NULL,
    site_name             TEXT NOT NULL,
    encrypted_credentials TEXT,
    created_at            TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_blog_platforms_tenant ON blog_platforms (tenant_id);

ALTER TABLE blog_platforms ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY "tenant_isolation" ON blog_platforms
        FOR ALL USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. google_business_profiles --------------------------------------------------
CREATE TABLE IF NOT EXISTS google_business_profiles (
    id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id       UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    client_id       UUID REFERENCES clients (id) ON DELETE CASCADE,
    account_name    TEXT NOT NULL,
    location_id     TEXT,
    encrypted_token TEXT,
    connected       BOOLEAN DEFAULT false,
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gbp_tenant ON google_business_profiles (tenant_id);
CREATE INDEX IF NOT EXISTS idx_gbp_client ON google_business_profiles (client_id);

ALTER TABLE google_business_profiles ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY "tenant_isolation" ON google_business_profiles
        FOR ALL USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 3. licenses -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS licenses (
    id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id       UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    license_key     TEXT UNIQUE NOT NULL,
    plan_id         TEXT NOT NULL,
    status          TEXT DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'expired', 'cancelled')),
    seats_total     INTEGER DEFAULT 1,
    seats_used      INTEGER DEFAULT 0,
    issued_at       TIMESTAMPTZ DEFAULT now(),
    expires_at      TIMESTAMPTZ,
    metadata        JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_licenses_tenant ON licenses (tenant_id);
CREATE INDEX IF NOT EXISTS idx_licenses_key ON licenses (license_key);

ALTER TABLE licenses ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY "tenant_isolation" ON licenses
        FOR ALL USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;