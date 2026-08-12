-- Migration: 029_docusign_and_location
--
-- Two features:
--
-- 1. DocuSign e-signature on SEO proposals. A proposal (seo_campaigns row) can
--    be sent for signature; the envelope id + status live here so the agency
--    sees Sent / Signed, and the Connect webhook flips status to signed and
--    auto-starts the campaign (campaign_plans) when the client completes.
--
-- 2. Location on the audit. The New Audit form now accepts the business
--    location so the auditor can qualify competitors, keywords and rankings
--    for the right market instead of being generic.

ALTER TABLE seo_campaigns ADD COLUMN IF NOT EXISTS docusign_envelope_id TEXT;
ALTER TABLE seo_campaigns ADD COLUMN IF NOT EXISTS docusign_status TEXT;
ALTER TABLE seo_campaigns ADD COLUMN IF NOT EXISTS docusign_signed_at TIMESTAMPTZ;
ALTER TABLE seo_campaigns ADD COLUMN IF NOT EXISTS signer_name TEXT;
ALTER TABLE seo_campaigns ADD COLUMN IF NOT EXISTS signer_email TEXT;
ALTER TABLE seo_campaigns ADD COLUMN IF NOT EXISTS location TEXT;

-- Signer email for DocuSign envelopes (agency-side, optional).
ALTER TABLE clients ADD COLUMN IF NOT EXISTS email TEXT;

CREATE INDEX IF NOT EXISTS idx_seo_campaigns_docusign
    ON seo_campaigns (docusign_envelope_id)
    WHERE docusign_envelope_id IS NOT NULL;
