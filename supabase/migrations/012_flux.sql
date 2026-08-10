-- ============================================================================
-- Migration: 012_flux
-- Description: Phase 4 — Flux (Creative Studio). Media assets table for
--              storing AI-generated images, videos, and voice audio.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. media_assets — Generated creative assets (images, video, voice)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS media_assets (
    id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id        UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    client_id        UUID REFERENCES clients (id) ON DELETE SET NULL,
    type             TEXT NOT NULL CHECK (type IN ('image', 'video', 'voice')),
    provider         TEXT,
    model            TEXT,
    prompt           TEXT NOT NULL,
    url              TEXT,
    thumbnail_url    TEXT,
    metadata         JSONB DEFAULT '{}',
    status           TEXT DEFAULT 'processing' CHECK (status IN (
                         'processing', 'completed', 'failed'
                     )),
    tags             TEXT[] DEFAULT '{}',
    created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_media_assets_tenant   ON media_assets (tenant_id);
CREATE INDEX IF NOT EXISTS idx_media_assets_client   ON media_assets (client_id);
CREATE INDEX IF NOT EXISTS idx_media_assets_type     ON media_assets (type);
CREATE INDEX IF NOT EXISTS idx_media_assets_status   ON media_assets (status);

ALTER TABLE media_assets ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY "tenant_isolation" ON media_assets
        FOR ALL USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;