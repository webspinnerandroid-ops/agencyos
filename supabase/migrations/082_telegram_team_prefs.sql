-- ============================================================================
-- 082_telegram_team_prefs.sql — /team switching + per-user cross-chat memory
--
--   telegram_links.active_employee_key : which employee this chat talks to
--       directly. NULL = the workspace's Team Room (Malory dispatches).
--       Set via the /team command or the one-tap team picker buttons.
--
--   telegram_user_prefs : per-USER prefs shared across every chat bound to
--       that user. When a new device connects (new chat_id), the bind flow
--       copies default_workspace_id (and the last active employee) onto the
--       fresh link so the user's choice follows them between devices.
--       Server-only (deny-all RLS) — nothing here is user-reachable.
-- ============================================================================

ALTER TABLE public.telegram_links
    ADD COLUMN IF NOT EXISTS active_employee_key TEXT;

CREATE INDEX IF NOT EXISTS idx_telegram_links_emp ON public.telegram_links (active_employee_key);

CREATE TABLE IF NOT EXISTS public.telegram_user_prefs (
    user_id              UUID PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
    tenant_id            UUID NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
    default_workspace_id UUID REFERENCES public.workspaces (id) ON DELETE SET NULL,
    active_employee_key  TEXT,
    updated_at           TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_telegram_prefs_tenant ON public.telegram_user_prefs (tenant_id);

ALTER TABLE public.telegram_user_prefs ENABLE ROW LEVEL SECURITY;
