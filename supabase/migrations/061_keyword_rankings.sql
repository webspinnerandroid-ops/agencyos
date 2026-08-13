-- 061 — per-query keyword rankings from Search Console
-- Populated by the syncSiteMetrics Inngest job: one row per search query per
-- connected SC site, so the campaign Current Rank column can show measured
-- positions instead of "—".

CREATE TABLE IF NOT EXISTS keyword_rankings (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    resource    TEXT NOT NULL,
    query       TEXT NOT NULL,
    clicks      INTEGER,
    impressions INTEGER,
    ctr         NUMERIC(8, 4),
    position    NUMERIC(8, 2),
    fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, resource, query)
);

ALTER TABLE keyword_rankings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "no_direct_access" ON keyword_rankings FOR ALL USING (false);

CREATE INDEX IF NOT EXISTS idx_keyword_rankings_tenant_query
    ON keyword_rankings (tenant_id, query);
