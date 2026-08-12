-- Migration: 027_campaign_item_seo_context
--
-- Approve-time transparency for campaign plan items: the proposed piece now
-- carries the SEO context the approving user needs to trust it — the target
-- keywords, the internal page it should link to, and suggested external
-- links (e.g. the proposal's link-building tasks). The approve dialog shows
-- these; generation passes the keywords into Cheryl/Pam's prompts.

ALTER TABLE campaign_plan_items
    ADD COLUMN IF NOT EXISTS keywords      TEXT[],
    ADD COLUMN IF NOT EXISTS internal_link TEXT,
    ADD COLUMN IF NOT EXISTS external_links TEXT[];
