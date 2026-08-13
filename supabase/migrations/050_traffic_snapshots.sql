-- 050 — site-traffic snapshots for GA4 and Search Console connections
-- Daily metrics pulled from the connected Google properties/sites by the
-- syncSiteMetrics Inngest job. GA4 fills sessions/users/pageviews/engagement;
-- Search Console fills clicks/impressions/ctr/position.

CREATE TABLE IF NOT EXISTS traffic_snapshots (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    provider        TEXT NOT NULL CHECK (provider IN ('google_analytics', 'search_console')),
    resource        TEXT NOT NULL,
    metric_date     DATE NOT NULL,
    sessions        INTEGER,
    users           INTEGER,
    pageviews       INTEGER,
    engagement_rate NUMERIC(8, 4),
    clicks          INTEGER,
    impressions     INTEGER,
    ctr             NUMERIC(8, 4),
    position        NUMERIC(8, 2),
    fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, provider, metric_date)
);

CREATE INDEX IF NOT EXISTS idx_traffic_snapshots_tenant_date
    ON traffic_snapshots (tenant_id, metric_date DESC);

ALTER TABLE traffic_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "no_direct_access" ON traffic_snapshots FOR ALL USING (false);
