-- Migration: 030_signed_contracts
--
-- Signed DocuSign contracts. When a proposal envelope completes, the signed
-- PDF is downloaded from DocuSign and stored in the workspace's Bunny storage
-- zone under contracts/<campaignId>-signed.pdf. This column holds the public
-- (pull-zone) URL so the agency — and later the client — can open the signed
-- contract from the app.

ALTER TABLE seo_campaigns ADD COLUMN IF NOT EXISTS signed_document_url TEXT;
