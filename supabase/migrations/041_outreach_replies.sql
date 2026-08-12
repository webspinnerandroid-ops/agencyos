-- 041 — outreach reply tracking.
-- Emails sent from the platform get a reply-webhook; replies land here so the
-- pipeline shows live conversations (discovered → pitched → replied → accepted
-- → published), and the dashboard can surface unseen replies.

ALTER TABLE outreach_targets
  ADD COLUMN IF NOT EXISTS last_reply_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_reply_text TEXT,
  ADD COLUMN IF NOT EXISTS reply_count     INT  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_reply_seen BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_outreach_replies
  ON outreach_targets (tenant_id, last_reply_at DESC NULLS LAST);
