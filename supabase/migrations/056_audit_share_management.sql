-- 056 — Audit share-link management.
--
-- Public audit links (/audit/[id]) are campaign-id based. Add:
--   share_enabled — revoke the link (public API returns 404 when false)
--   share_token   — regenerate: a fresh unguessable token becomes the new
--                   public link (/audit/[token]); NULL keeps the id-based link.
-- Existing audits stay shareable by default (share_enabled defaults true).

ALTER TABLE seo_campaigns
    ADD COLUMN IF NOT EXISTS share_enabled boolean NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS share_token text;

-- Regenerated tokens must be unique and indexed for fast public lookups.
CREATE UNIQUE INDEX IF NOT EXISTS seo_campaigns_share_token_key
    ON seo_campaigns (share_token)
    WHERE share_token IS NOT NULL;
