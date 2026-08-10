-- ============================================================================
-- Migration: 011_cipher_haven
-- Description: Phase 3 — Cipher (lead intelligence + CRM) and Haven
--              (voice receptionist). Adds 5 tables.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. leads — Core lead/contact database
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS leads (
    id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id        UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    client_id        UUID REFERENCES clients (id) ON DELETE SET NULL,
    email            TEXT,
    first_name       TEXT,
    last_name        TEXT,
    company          TEXT,
    title            TEXT,
    phone            TEXT,
    linkedin_url     TEXT,
    source           TEXT DEFAULT 'manual' CHECK (source IN (
                         'apollo', 'referral', 'website', 'manual', 'csv_import'
                     )),
    status           TEXT DEFAULT 'new' CHECK (status IN (
                         'new', 'contacted', 'qualified', 'proposal_sent',
                         'closed_won', 'closed_lost', 'unqualified'
                     )),
    apollo_enriched  BOOLEAN DEFAULT false,
    enrichment_data  JSONB DEFAULT '{}',
    notes            TEXT,
    assigned_to      UUID REFERENCES auth.users (id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ DEFAULT now(),
    updated_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leads_tenant    ON leads (tenant_id);
CREATE INDEX IF NOT EXISTS idx_leads_client    ON leads (client_id);
CREATE INDEX IF NOT EXISTS idx_leads_status    ON leads (status);
CREATE INDEX IF NOT EXISTS idx_leads_email     ON leads (email);

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY "tenant_isolation" ON leads
        FOR ALL USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ----------------------------------------------------------------------------
-- 2. lead_activities — Timeline of all interactions
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lead_activities (
    id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    lead_id          UUID NOT NULL REFERENCES leads (id) ON DELETE CASCADE,
    tenant_id        UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    type             TEXT NOT NULL CHECK (type IN (
                         'call', 'email', 'sms', 'note', 'status_change', 'sequence_step'
                     )),
    direction        TEXT CHECK (direction IN ('inbound', 'outbound')),
    subject          TEXT,
    body             TEXT,
    from_address     TEXT,
    to_address       TEXT,
    twilio_sid       TEXT,
    resend_id        TEXT,
    call_log_id      UUID,
    created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_activities_lead   ON lead_activities (lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_activities_tenant ON lead_activities (tenant_id);
CREATE INDEX IF NOT EXISTS idx_lead_activities_type   ON lead_activities (type);

ALTER TABLE lead_activities ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY "tenant_isolation" ON lead_activities
        FOR ALL USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ----------------------------------------------------------------------------
-- 3. sequences — Outreach drip campaigns
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sequences (
    id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id        UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    name             TEXT NOT NULL,
    description      TEXT,
    steps            JSONB DEFAULT '[]',
    is_active        BOOLEAN DEFAULT false,
    created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sequences_tenant ON sequences (tenant_id);

ALTER TABLE sequences ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY "tenant_isolation" ON sequences
        FOR ALL USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ----------------------------------------------------------------------------
-- 4. sequence_enrollments — Tracks leads in sequences
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sequence_enrollments (
    id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    lead_id          UUID NOT NULL REFERENCES leads (id) ON DELETE CASCADE,
    sequence_id      UUID NOT NULL REFERENCES sequences (id) ON DELETE CASCADE,
    tenant_id        UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    current_step     INT DEFAULT 0,
    paused           BOOLEAN DEFAULT false,
    next_action_at   TIMESTAMPTZ,
    enrolled_at      TIMESTAMPTZ DEFAULT now(),
    completed_at     TIMESTAMPTZ,
    UNIQUE (lead_id, sequence_id)
);

CREATE INDEX IF NOT EXISTS idx_sequence_enr_lead       ON sequence_enrollments (lead_id);
CREATE INDEX IF NOT EXISTS idx_sequence_enr_next_action ON sequence_enrollments (next_action_at)
    WHERE paused = false AND completed_at IS NULL;

ALTER TABLE sequence_enrollments ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY "tenant_isolation" ON sequence_enrollments
        FOR ALL USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ----------------------------------------------------------------------------
-- 5. call_logs — Voice interactions via Twilio + ElevenLabs
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS call_logs (
    id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id        UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    lead_id          UUID REFERENCES leads (id) ON DELETE SET NULL,
    twilio_call_sid  TEXT UNIQUE,
    direction        TEXT CHECK (direction IN ('inbound', 'outbound')),
    from_number      TEXT,
    to_number        TEXT,
    status           TEXT DEFAULT 'ringing' CHECK (status IN (
                         'ringing', 'in-progress', 'completed', 'failed',
                         'busy', 'no-answer', 'canceled'
                     )),
    duration_seconds INT,
    recording_url    TEXT,
    transcript       TEXT,
    ai_response      TEXT,
    started_at       TIMESTAMPTZ,
    ended_at         TIMESTAMPTZ,
    created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_call_logs_tenant  ON call_logs (tenant_id);
CREATE INDEX IF NOT EXISTS idx_call_logs_lead    ON call_logs (lead_id);
CREATE INDEX IF NOT EXISTS idx_call_logs_sid     ON call_logs (twilio_call_sid);
CREATE INDEX IF NOT EXISTS idx_call_logs_status  ON call_logs (status);

ALTER TABLE call_logs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY "tenant_isolation" ON call_logs
        FOR ALL USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- COMPLETE
-- ============================================================================