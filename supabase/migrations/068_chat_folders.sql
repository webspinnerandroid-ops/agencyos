-- ============================================================================
-- Migration: 068_chat_folders
-- Description:
--   Optional folder/project label on AI team chats so the owner can file
--   chats into folders (e.g. per client or per campaign) in the sidebar.
--   NULL = unfiled. Purely organizational — no constraints beyond a sane
--   length guard applied at the API layer.
-- ============================================================================

ALTER TABLE team_chats ADD COLUMN IF NOT EXISTS folder TEXT;

COMMENT ON COLUMN team_chats.folder IS
  'Optional folder/project name to group chats in the sidebar. NULL = unfiled.';
