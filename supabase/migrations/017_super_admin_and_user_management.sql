-- ============================================================================
-- Migration: 017_super_admin_and_user_management
-- Description:
--   1. Promote webspinnerandroid@gmail.com to super_admin
--   2. Split mike@webspinnermedia.com into its own fresh tenant
--      (own workspace, brand profile, trialing subscription, trial license)
--   3. Flag licenses issued at registration with metadata.is_trial so the
--      admin UI can show a Trial badge
-- NOTE: licenses.status CHECK constraint only permits
--       active/suspended/expired/cancelled, so trials stay status='active'
--       and are flagged via metadata.is_trial.
-- ============================================================================

-- 1. Promote the owner to super_admin ---------------------------------------
UPDATE public.user_roles ur
SET role = 'super_admin'
FROM auth.users u
WHERE ur.user_id = u.id
  AND u.email = 'webspinnerandroid@gmail.com'
  AND ur.role <> 'super_admin';

-- 2. Move mike@webspinnermedia.com into a fresh tenant -----------------------
DO $$
DECLARE
    v_user_id      UUID;
    v_old_tenant   UUID;
    v_new_tenant   UUID;
    v_workspace_id UUID;
    v_license_key  TEXT;
BEGIN
    SELECT u.id, ur.tenant_id INTO v_user_id, v_old_tenant
    FROM auth.users u
    JOIN public.user_roles ur ON ur.user_id = u.id
    WHERE u.email = 'mike@webspinnermedia.com'
    LIMIT 1;

    IF v_user_id IS NULL THEN
        RAISE NOTICE 'mike@webspinnermedia.com not found - skipping split';
        RETURN;
    END IF;

    -- Create the new tenant
    INSERT INTO tenants (name, slug, primary_color)
    VALUES ('Mike Media', 'mike-media-' || substr(md5(random()::text), 1, 8), '#2563eb')
    RETURNING id INTO v_new_tenant;

    -- Reassign his user_role to the new tenant (keeps role agency_admin)
    UPDATE public.user_roles
    SET tenant_id = v_new_tenant
    WHERE user_id = v_user_id;

    -- Default workspace
    INSERT INTO workspaces (tenant_id, name, slug, is_default)
    VALUES (v_new_tenant, 'Default Workspace', 'default', true)
    RETURNING id INTO v_workspace_id;

    -- Default brand profile
    INSERT INTO brand_profiles (workspace_id, tenant_id, name, is_default)
    VALUES (v_workspace_id, v_new_tenant, 'Default Brand Profile', true);

    -- Trialing subscription
    INSERT INTO subscriptions (tenant_id, plan_id, status)
    VALUES (v_new_tenant, 'starter', 'trialing');

    -- 14-day trial license (status stays 'active' per CHECK constraint,
    -- Trial badge is derived from metadata.is_trial)
    v_license_key := 'AOS-' || upper(substr(md5(random()::text), 1, 12)) || '-TRIAL';
    INSERT INTO licenses (
        tenant_id, license_key, plan_id, status,
        seats_total, seats_used, expires_at, metadata
    )
    VALUES (
        v_new_tenant, v_license_key, 'starter', 'active',
        1, 1, now() + interval '14 days',
        jsonb_build_object('is_trial', true)
    );
END $$;

-- 3. Flag registration-issued licenses as trials -------------------------------
-- Licenses whose key ends in -TRIAL are 14-day trials issued at signup.
UPDATE public.licenses
SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('is_trial', true)
WHERE license_key ILIKE '%-TRIAL'
  AND (metadata IS NULL OR NOT (metadata ? 'is_trial'));
