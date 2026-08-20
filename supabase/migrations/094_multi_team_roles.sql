-- 093 — allow a user to belong to multiple teams (multi-tenant membership)
--
-- user_roles.user_id was the primary key, which enforced "one role per user"
-- and made it impossible to add a person who already belongs to another team.
-- Make the key composite (user_id, tenant_id) so a person can be a member of
-- several tenants at once. Also add created_at so auth resolution can pick
-- the most recent team deterministically when no tenant preference is stored.

ALTER TABLE public.user_roles
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

UPDATE public.user_roles SET created_at = now() WHERE created_at IS NULL;

ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_pkey;
ALTER TABLE public.user_roles ADD PRIMARY KEY (user_id, tenant_id);

CREATE INDEX IF NOT EXISTS idx_user_roles_user ON public.user_roles (user_id);
