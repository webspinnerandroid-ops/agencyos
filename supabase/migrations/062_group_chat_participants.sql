-- 062 — group chats for the AI team.
-- A DM (kind 'employee') can be converted into a group room with multiple
-- participants. `participants` is a JSONB array of employee keys; null/absent
-- means "not a group" (Team Room and plain named rooms dispatch to anyone).

ALTER TABLE team_chats ADD COLUMN IF NOT EXISTS participants JSONB;

COMMENT ON COLUMN team_chats.participants IS
  'Employee keys in a group chat (kind room). Null = dispatch to anyone.';
