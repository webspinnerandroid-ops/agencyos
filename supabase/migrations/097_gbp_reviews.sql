-- 097 — gbp_reviews: review snapshots for Google Business Profile listings.
--
-- Written by the hourly review-sync worker (Inngest) and the on-demand
-- "Refresh reviews" action. Each row is the latest known state of one Google
-- review for one connected listing, so new reviews can trigger in-app
-- notifications and AI reply drafts survive re-syncs.
--
-- reply_text = locally drafted (AI) reply not yet posted on Google. It is
-- deliberately excluded from the sync's conflict-update set so a re-sync
-- never wipes a draft; reply_comment (Google's own record) updates freely.

CREATE TABLE IF NOT EXISTS gbp_reviews (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    workspace_id   UUID REFERENCES workspaces (id) ON DELETE CASCADE,
    profile_id     UUID NOT NULL REFERENCES google_business_profiles (id) ON DELETE CASCADE,
    review_id      TEXT NOT NULL,
    star_rating    TEXT NOT NULL DEFAULT 'FIVE',  -- Google enum: ONE..FIVE
    comment        TEXT,
    reviewer_name  TEXT,
    create_time    TIMESTAMPTZ,
    replied        BOOLEAN NOT NULL DEFAULT false,
    reply_comment  TEXT,                          -- the reply Google shows
    reply_text     TEXT,                          -- local AI draft (pre-post)
    notified_at    TIMESTAMPTZ,
    fetched_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (profile_id, review_id)
);

CREATE INDEX IF NOT EXISTS idx_gbp_reviews_tenant
    ON gbp_reviews (tenant_id, create_time DESC);
CREATE INDEX IF NOT EXISTS idx_gbp_reviews_profile
    ON gbp_reviews (profile_id, fetched_at DESC);

ALTER TABLE gbp_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "no_direct_access" ON gbp_reviews FOR ALL USING (false);

-- Baseline flag: true once a listing's first review sync has run. The sync
-- fires notifications only for reviews that arrive AFTER the baseline, so
-- connecting a business doesn't spam the bell with years of old reviews.
ALTER TABLE google_business_profiles
    ADD COLUMN IF NOT EXISTS baseline_synced BOOLEAN NOT NULL DEFAULT false;

-- Google's own aggregate stats, cached on each sync so snapshot reads can
-- show the true rating/count (the stored review window is only the latest 50).
ALTER TABLE google_business_profiles
    ADD COLUMN IF NOT EXISTS average_rating NUMERIC(3, 2);
ALTER TABLE google_business_profiles
    ADD COLUMN IF NOT EXISTS total_review_count INTEGER;

-- Per-tenant sync bookkeeping shared by the hourly worker and manual
-- "Sync now" clicks: last_sync_started throttles manual refreshes to one per
-- minute so nobody hammers the Google quota; last_sync_ok powers the
-- "last synced X minutes ago" stamp in the UI.
CREATE TABLE IF NOT EXISTS gbp_sync_state (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id          UUID NOT NULL UNIQUE REFERENCES tenants (id) ON DELETE CASCADE,
    last_sync_started  TIMESTAMPTZ,
    last_sync_ok       TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE gbp_sync_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "no_direct_access" ON gbp_sync_state FOR ALL USING (false);
