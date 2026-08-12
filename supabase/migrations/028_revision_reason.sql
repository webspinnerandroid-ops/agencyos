-- Migration: 028_revision_reason
--
-- Store WHY a post was sent back for revision. The agency-side calendar
-- "Request Revision" now asks for a reason and persists it here (the portal
-- side already captures a comment); the reason surfaces on the post detail
-- so the team can actually act on it instead of guessing.

ALTER TABLE posts ADD COLUMN IF NOT EXISTS revision_reason TEXT;
