-- Migration: 026_campaign_plan_owner — backfill the owner column that was
-- missing from the version of 024 applied to hosted.
--
-- The on-disk 024 includes `campaign_plan_items.owner` (which AI employee
-- executes each proposed piece), but the hosted DB ran the pre-amendment
-- version. This additively restores the column; on a fresh DB where 024
-- already created it, the IF NOT EXISTS makes this a no-op.

ALTER TABLE campaign_plan_items
    ADD COLUMN IF NOT EXISTS owner TEXT;
