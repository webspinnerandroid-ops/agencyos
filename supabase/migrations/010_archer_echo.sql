-- ============================================================================
-- Migration: 010_archer_echo
-- Description: Tables for Phase 2 — Archer (email inbox + calendar) and
--              Echo (social inbox + engagement). Extends the existing
--              comments table with platform metadata.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. email_accounts — connected Gmail / Outlook accounts per tenant
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_accounts (
    id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id         UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    platform          TEXT NOT NULL CHECK (platform IN ('gmail', 'outlook')),
    email_address     TEXT NOT NULL,
    account_name      TEXT,
    encrypted_token   TEXT NOT NULL,
    sync_cursor       TEXT,
    last_synced_at    TIMESTAMPTZ,
    created_at        TIMESTAMPTZ DEFAULT now(),
    UNIQUE (tenant_id, platform, email_address)
);

CREATE INDEX IF NOT EXISTS idx_email_accounts_tenant ON email_accounts (tenant_id);
CREATE INDEX IF NOT EXISTS idx_email_accounts_platform ON email_accounts (platform);

ALTER TABLE email_accounts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY "tenant_isolation" ON email_accounts
        FOR ALL USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ----------------------------------------------------------------------------
-- 2. calendar_events — synced from Gmail / Outlook calendars
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS calendar_events (
    id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id         UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    email_account_id  UUID NOT NULL REFERENCES email_accounts (id) ON DELETE CASCADE,
    external_id       TEXT NOT NULL,
    title             TEXT,
    description       TEXT,
    start_time        TIMESTAMPTZ,
    end_time          TIMESTAMPTZ,
    location          TEXT,
    attendees         JSONB DEFAULT '[]',
    status            TEXT DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'tentative', 'cancelled')),
    raw_json          JSONB DEFAULT '{}',
    synced_at         TIMESTAMPTZ DEFAULT now(),
    UNIQUE (email_account_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_calendar_events_tenant    ON calendar_events (tenant_id);
CREATE INDEX IF NOT EXISTS idx_calendar_events_account   ON calendar_events (email_account_id);
CREATE INDEX IF NOT EXISTS idx_calendar_events_start     ON calendar_events (start_time);

ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY "tenant_isolation" ON calendar_events
        FOR ALL USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ----------------------------------------------------------------------------
-- 3. Extend comments for social inbox (Echo)
--    All columns are nullable so existing rows are unaffected.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    -- platform
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'comments' AND column_name = 'platform'
    ) THEN
        ALTER TABLE comments ADD COLUMN platform TEXT;
    END IF;

    -- platform_comment_id
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'comments' AND column_name = 'platform_comment_id'
    ) THEN
        ALTER TABLE comments ADD COLUMN platform_comment_id TEXT;
    END IF;

    -- parent_comment_id (for threaded replies)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'comments' AND column_name = 'parent_comment_id'
    ) THEN
        ALTER TABLE comments ADD COLUMN parent_comment_id UUID REFERENCES comments (id) ON DELETE SET NULL;
    END IF;

    -- author_name
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'comments' AND column_name = 'author_name'
    ) THEN
        ALTER TABLE comments ADD COLUMN author_name TEXT;
    END IF;

    -- author_avatar_url
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'comments' AND column_name = 'author_avatar_url'
    ) THEN
        ALTER TABLE comments ADD COLUMN author_avatar_url TEXT;
    END IF;

    -- is_read
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'comments' AND column_name = 'is_read'
    ) THEN
        ALTER TABLE comments ADD COLUMN is_read BOOLEAN DEFAULT false;
    END IF;

    -- inbox_status
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'comments' AND column_name = 'inbox_status'
    ) THEN
        ALTER TABLE comments ADD COLUMN inbox_status TEXT DEFAULT 'unread' CHECK (
            inbox_status IN ('unread', 'read', 'replied', 'archived', 'spam')
        );
    END IF;

    -- engagement_data (likes, shares, sentiment)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'comments' AND column_name = 'engagement_data'
    ) THEN
        ALTER TABLE comments ADD COLUMN engagement_data JSONB DEFAULT '{}';
    END IF;
END $$;

-- Index for social inbox queries
CREATE INDEX IF NOT EXISTS idx_comments_inbox_status ON comments (inbox_status) WHERE inbox_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_comments_platform ON comments (platform) WHERE platform IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_comments_platform_comment_id ON comments (platform_comment_id) WHERE platform_comment_id IS NOT NULL;

-- ============================================================================
-- COMPLETE
-- ============================================================================