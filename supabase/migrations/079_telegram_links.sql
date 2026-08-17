-- ============================================================================
-- 079_telegram_links.sql — Telegram integration
--   telegram_links       : bound Telegram chat_id ↔ app user (per tenant)
--   telegram_link_codes  : one-time start codes for the in-app connect flow
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.telegram_links (
    id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id      UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
    tenant_id    UUID NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
    chat_id      TEXT NOT NULL UNIQUE,
    bot_username TEXT,
    alert_only   BOOLEAN NOT NULL DEFAULT FALSE,
    bound_at     TIMESTAMPTZ DEFAULT now(),
    created_at   TIMESTAMPTZ DEFAULT now(),
    UNIQUE (user_id, chat_id)
);

CREATE INDEX IF NOT EXISTS idx_telegram_links_user   ON public.telegram_links (user_id);
CREATE INDEX IF NOT EXISTS idx_telegram_links_tenant ON public.telegram_links (tenant_id);

-- One-time /start codes — the app generates one per connect attempt; the
-- Telegram webhook consumes it when the user taps t.me/<bot>?start=<code>.
CREATE TABLE IF NOT EXISTS public.telegram_link_codes (
    code       TEXT PRIMARY KEY,
    user_id    UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
    tenant_id  UUID NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at    TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_telegram_link_codes_user ON public.telegram_link_codes (user_id);

-- RLS: deny all — only server code (service role) reads/writes these.
ALTER TABLE public.telegram_links       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_link_codes   ENABLE ROW LEVEL SECURITY;
