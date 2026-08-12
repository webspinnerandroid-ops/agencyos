-- Migration: 046_campaign_website_items
-- Description: Allow campaign plan items to represent website-build
--              milestones (seeded when the owner starts a campaign and
--              opts to include a website build). These items are owned by
--              Ray (dev) and approved as tracked milestones — approving
--              does NOT generate content, it points at the Web Builder.

ALTER TABLE campaign_plan_items
  DROP CONSTRAINT IF EXISTS campaign_plan_items_kind_check;

ALTER TABLE campaign_plan_items
  ADD CONSTRAINT campaign_plan_items_kind_check
  CHECK (kind IN ('blog', 'social', 'website'));
