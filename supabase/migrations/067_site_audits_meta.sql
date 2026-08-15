-- 067 — site_audits.meta: JSONB metadata column.
-- Stores per-run extras that don't belong in checks_json: rewrite origin
-- scores / attempt history, the Rank Math meta payload + schema preview, etc.
-- Used by the text-rewrite flow (paste → rewrite → save) so the Monitored
-- Sites dashboard can show what a rewrite changed and what Rank Math data a
-- piece carries.

ALTER TABLE site_audits
    ADD COLUMN IF NOT EXISTS meta JSONB;
