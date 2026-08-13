-- ============================================================================
-- Migration: 059_sign_requests
--
-- In-house e-signature flow (no third-party e-sign vendor needed): the agency
-- sends the client a secure signing link, the client signs on the public
-- /sign/[token] page (typed or drawn signature), and the signed agreement is
-- archived into the workspace's Bunny storage. The signed document URL and
-- signature metadata are stored here, and mirrored onto seo_campaigns
-- (docusign_status / docusign_signed_at / signer_* / signed_document_url so
-- the existing proposal-status UI keeps working unchanged).
--
-- All access goes through server routes (tenant-scoped service client for the
-- agency side; token-gated public routes for the client side), so like
-- subscription_registry this table has no direct client access.
-- ============================================================================

CREATE TABLE IF NOT EXISTS sign_requests (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  campaign_id         UUID REFERENCES seo_campaigns(id) ON DELETE CASCADE,
  workspace_id        UUID,
  client_id           UUID,
  token               TEXT NOT NULL UNIQUE,
  status              TEXT NOT NULL DEFAULT 'sent',   -- sent | signed | declined | expired
  signer_name         TEXT,
  signer_email        TEXT,
  sent_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  signed_at           TIMESTAMPTZ,
  signature_data      TEXT,   -- data URL of the drawn signature (drawn only)
  signature_type      TEXT,   -- 'typed' | 'drawn'
  ip_address          TEXT,
  user_agent          TEXT,
  signed_document_url TEXT,
  created_by          UUID,
  expires_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE sign_requests ENABLE ROW LEVEL SECURITY;
-- No direct client access — reads/writes go through server routes only.
CREATE POLICY "no_direct_access" ON sign_requests FOR ALL USING (false);

-- Index for the token lookup on the public signing page.
CREATE INDEX IF NOT EXISTS sign_requests_token_idx ON sign_requests (token);
CREATE INDEX IF NOT EXISTS sign_requests_campaign_idx ON sign_requests (campaign_id);
