-- ============================================================================
-- 081_push_subscriptions.sql — PWA web push
--
--   vapid_keys          : singleton (id=1) holding the app's VAPID keypair
--                         (JWK private + base64url raw public). Generated
--                         once on first use, never committed to the repo.
--   push_subscriptions : one row per browser that enabled notifications.
--                         Endpoints are unique — re-subscribing from a new
--                         session upserts. All access is server-only
--                         (deny-all RLS); nothing here is user-reachable.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.vapid_keys (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  private_jwk TEXT NOT NULL,
  public_key  TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.vapid_keys ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  tenant_id   UUID NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL UNIQUE,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  last_seen_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_subs_tenant ON public.push_subscriptions (tenant_id);
CREATE INDEX IF NOT EXISTS idx_push_subs_user   ON public.push_subscriptions (user_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;