-- ============================================================================
-- 080_telegram_workspace.sql — per-chat active workspace for Telegram
--
-- Each bound Telegram chat remembers which workspace its messages route to.
-- NULL = the tenant's first workspace (the previous behaviour). The /workspace
-- command sets it; /workspaces lists the options.
-- ============================================================================

ALTER TABLE public.telegram_links
    ADD COLUMN IF NOT EXISTS active_workspace_id UUID REFERENCES public.workspaces (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_telegram_links_ws ON public.telegram_links (active_workspace_id);
