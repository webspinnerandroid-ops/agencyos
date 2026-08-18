-- ============================================================================
-- 083_discord_links.sql — two-way Discord bot chat
--
--   discord_links        : bound Discord DM (discord_user_id + channel_id) ↔
--                          app user/tenant. The bot's gateway delivers inbound
--                          DMs and the app replies over the same channel via
--                          the bot's REST API. Mirrors telegram_links:
--                          active_workspace_id + active_employee_key route the
--                          conversation to a workspace's Team Room or a single
--                          employee's DM.
--
--   discord_link_codes   : one-time /connect codes (the in-app Settings →
--                          Discord "Generate connect link" flow). The user DMs
--                          the bot `/connect <code>` and the gateway binds.
--
--   Server-only (deny-all RLS) — nothing here is user-reachable.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.discord_links (
    id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id             UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
    tenant_id           UUID NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
    discord_user_id     TEXT NOT NULL UNIQUE,
    channel_id          TEXT NOT NULL,
    guild_id            TEXT,
    active_workspace_id UUID REFERENCES public.workspaces (id) ON DELETE SET NULL,
    active_employee_key TEXT,
    bound_at            TIMESTAMPTZ DEFAULT now(),
    created_at          TIMESTAMPTZ DEFAULT now(),
    UNIQUE (user_id, channel_id)
);

CREATE INDEX IF NOT EXISTS idx_discord_links_user   ON public.discord_links (user_id);
CREATE INDEX IF NOT EXISTS idx_discord_links_tenant ON public.discord_links (tenant_id);
CREATE INDEX IF NOT EXISTS idx_discord_links_channel ON public.discord_links (channel_id);

CREATE TABLE IF NOT EXISTS public.discord_link_codes (
    code       TEXT PRIMARY KEY,
    user_id    UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
    tenant_id  UUID NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at    TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_discord_link_codes_user ON public.discord_link_codes (user_id);

ALTER TABLE public.discord_links       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discord_link_codes  ENABLE ROW LEVEL SECURITY;
