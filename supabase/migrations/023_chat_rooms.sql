-- ============================================================================
-- Migration: 023_chat_rooms
-- Description:
--   Users want to start NEW chats per workspace and revisit the history later.
--   team_chats.kind gains 'room' (user-named, unlimited per workspace) while
--   the Team Room (kind 'team') and employee DMs (kind 'employee') stay unique
--   per (tenant, workspace, client). The old table-level UNIQUE constraint is
--   replaced by two partial unique indexes so rooms aren't blocked by it.
-- ============================================================================

-- 1. Extend the kind check to allow rooms.
ALTER TABLE team_chats DROP CONSTRAINT IF EXISTS team_chats_kind_check;
ALTER TABLE team_chats
    ADD CONSTRAINT team_chats_kind_check
    CHECK (kind IN ('team', 'employee', 'room'));

-- 2. Drop the blanket UNIQUE (tenant, workspace, client, kind, employee_key) —
--    it would block a second 'room' row per workspace (employee_key IS NULL
--    for every room, so they'd all collide).
ALTER TABLE team_chats
    DROP CONSTRAINT IF EXISTS team_chats_tenant_id_workspace_id_client_id_kind_employee_key_key;

-- 3. Keep the Team Room unique per (tenant, workspace, client).
CREATE UNIQUE INDEX IF NOT EXISTS uq_team_chats_team_room
    ON team_chats (tenant_id, workspace_id, client_id)
    WHERE kind = 'team';

-- 4. Keep each employee DM unique per (tenant, workspace, client, employee).
CREATE UNIQUE INDEX IF NOT EXISTS uq_team_chats_employee_dm
    ON team_chats (tenant_id, workspace_id, client_id, employee_key)
    WHERE kind = 'employee';
