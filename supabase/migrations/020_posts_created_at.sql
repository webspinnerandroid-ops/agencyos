-- ============================================================================
-- 020: posts.created_at — "Recent Content" needs real creation order
-- ----------------------------------------------------------------------------
-- The dashboard's Recent Content list used to order by scheduled_at, but every
-- draft has scheduled_at = NULL, so the order was arbitrary (whichever rows
-- Postgres happened to return first) and freshly generated posts didn't appear
-- at the top. Add a real created_at column and index for it.
--
-- Existing rows get the migration-time timestamp (we don't have their true
-- creation time); anything generated after this migration is correctly ordered.
-- ============================================================================

ALTER TABLE posts
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Cover the dashboard's "recent posts per tenant" query.
CREATE INDEX IF NOT EXISTS idx_posts_tenant_created
    ON posts (tenant_id, created_at DESC);
