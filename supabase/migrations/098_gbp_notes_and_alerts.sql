-- 098 — digest reply notes + 1-star alert webhooks.
--
-- 1) gbp_reviews.internal_notes: replies to the weekly reputation digest
--    email land here as timestamped notes (via /api/gbp/digest-reply), shown
--    inline on the review in the dashboard. A plain TEXT[] of
--    "[YYYY-MM-DD from sender] text" entries — append-only, no new table.
--
-- 2) gbp_alert_webhooks: per-tenant Slack/Discord webhook URLs that get an
--    immediate push whenever a new 1★ review arrives on any connected
--    listing. min_stars sets the trigger threshold (1 = only 1★).

ALTER TABLE gbp_reviews
    ADD COLUMN IF NOT EXISTS internal_notes TEXT[] NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS gbp_alert_webhooks (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    workspace_id  UUID REFERENCES workspaces (id) ON DELETE CASCADE,
    label         TEXT,
    webhook_url   TEXT NOT NULL,
    -- Lowest star rating that triggers this hook: 1 = only 1★, 3 = 3★ and
    -- worse. NULL = every new review.
    min_stars     SMALLINT CHECK (min_stars BETWEEN 1 AND 5),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, webhook_url)
);

CREATE INDEX IF NOT EXISTS idx_gbp_alert_webhooks_tenant
    ON gbp_alert_webhooks (tenant_id);

ALTER TABLE gbp_alert_webhooks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "no_direct_access" ON gbp_alert_webhooks FOR ALL USING (false);
