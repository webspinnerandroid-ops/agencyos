-- ============================================================================
-- Migration: 007_seo_campaign_fields
-- Description: Add missing columns to seo_campaigns for full campaign data
-- ============================================================================

ALTER TABLE seo_campaigns ADD COLUMN IF NOT EXISTS url TEXT;
ALTER TABLE seo_campaigns ADD COLUMN IF NOT EXISTS tier_price INTEGER;
ALTER TABLE seo_campaigns ADD COLUMN IF NOT EXISTS audit_json JSONB;
ALTER TABLE seo_campaigns ADD COLUMN IF NOT EXISTS competitors_json JSONB;
ALTER TABLE seo_campaigns ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_seo_campaigns_url ON seo_campaigns (url);
CREATE INDEX IF NOT EXISTS idx_seo_campaigns_created_by ON seo_campaigns (created_by);