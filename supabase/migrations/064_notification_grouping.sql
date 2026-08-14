-- 064 — group notifications by the work that produced them.
-- A burst of updates about one task (in-progress → published → failed, or
-- several chat replies) collapses into a single group in the notifications
-- center. null = not part of any group.

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS group_key TEXT;

CREATE INDEX IF NOT EXISTS idx_notifications_group
    ON notifications (tenant_id, group_key, created_at DESC);
