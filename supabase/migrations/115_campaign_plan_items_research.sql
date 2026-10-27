-- Migration: 115_campaign_plan_items_research
-- Description: Fix 046's re-tightened campaign_plan_items_kind_check to
--              re-admit 'research'. The campaign-plan creator path
--              (src/lib/campaign-from-proposal.ts, commit 5351d1d) always
--              writes foundation research milestones (voice, persona,
--              buyer personas) with kind='research' — since 046 every
--              POST /api/campaign-plans/from-proposal failed with a 500
--              check-constraint violation ("violates check constraint
--              campaign_plan_items_kind_check").
--
-- Keep 'website' (website-build milestones, owner: Ray/dev, from 046) and
-- allow 'research' alongside blog and social.

ALTER TABLE campaign_plan_items
  DROP CONSTRAINT IF EXISTS campaign_plan_items_kind_check;

ALTER TABLE campaign_plan_items
  ADD CONSTRAINT campaign_plan_items_kind_check
  CHECK (kind IN ('blog', 'social', 'website', 'research'));
