-- ============================================================================
-- Migration: 111_make_relay_config
--
-- The Make.com publishing relay — the no-Meta-review path to Facebook,
-- Instagram, LinkedIn, TikTok, Threads, and Reddit publishing.
--
-- Instead of each tenant walking Meta's App Review / Business Verification
-- to get direct publish permissions, the tenant pastes ONE Make.com webhook
-- URL (their own Make scenario). The social publisher POSTs a JSON payload
-- { platform, caption, mediaUrls, scheduledAt, postPlatformId } to that
-- webhook; Make's pre-approved Meta app delivers to the platform.
--
-- Storage mirrors tenant_api_keys: the webhook URL is encrypted at rest
-- (encrypted_url BYTEA) because anyone holding the URL can post to the
-- tenant's connected Make scenario.
-- ============================================================================

CREATE TABLE IF NOT EXISTS make_relay_config (
    id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id      UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    -- Encrypted webhook URL (same AES-256-GCM scheme as tenant_api_keys)
    encrypted_url  BYTEA NOT NULL,
    -- Last 8 chars for display ("…ab12cd34") so the UI can show what's set
    -- without decrypting.
    url_hint       TEXT,
    enabled        BOOLEAN DEFAULT true,
    -- Last test-send result (from the Settings → Social "Send test" button)
    last_test_at   TIMESTAMPTZ,
    last_test_ok   BOOLEAN,
    last_test_error TEXT,
    created_at     TIMESTAMPTZ DEFAULT now(),
    updated_at     TIMESTAMPTZ DEFAULT now(),
    -- One relay config per tenant (the webhook routes per platform inside Make)
    UNIQUE (tenant_id)
);

ALTER TABLE make_relay_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation" ON make_relay_config;
CREATE POLICY "tenant_isolation" ON make_relay_config
    USING (tenant_id = (NULLIF(current_setting('request.header.x-tenant-id', true), '')::uuid));

CREATE INDEX IF NOT EXISTS idx_make_relay_tenant ON make_relay_config (tenant_id);
