-- ============================================================================
-- Migration: 014_cleanup_old_deepseek_models
-- Description: Delete the legacy deepseek-chat and deepseek-reasoner model rows
--              that don't work with the current DeepSeek API. Migration 013
--              already added deepseek-v4-pro and deepseek-v4-flash as replacements.
-- ============================================================================

-- See migration 009 for the old rows:
--   10000000-0000-0000-0000-000000000001 = deepseek-chat
--   10000000-0000-0000-0000-000000000002 = deepseek-reasoner

DELETE FROM ai_models
WHERE id IN (
  '10000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000002'
);