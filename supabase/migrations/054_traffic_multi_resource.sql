-- 054 — multi-property traffic sources
-- 1) Cache the connectable GA4 properties / Search Console sites per
--    connection so the Traffic tab can offer a property picker without a
--    live Google round-trip on every load.
ALTER TABLE tenant_connections
    ADD COLUMN IF NOT EXISTS available_resources JSONB;

-- 2) A tenant may now track several GA4 properties / SC sites over time, so
--    the daily snapshots must be unique per resource, not per provider.
--    (Old rows are kept; the constraint is widened, not dropped.)
ALTER TABLE traffic_snapshots
    DROP CONSTRAINT IF EXISTS traffic_snapshots_tenant_id_provider_metric_date_key;
CREATE UNIQUE INDEX IF NOT EXISTS traffic_snapshots_tenant_provider_resource_date_key
    ON traffic_snapshots (tenant_id, provider, resource, metric_date);
