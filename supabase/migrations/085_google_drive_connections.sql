-- 085 — Google Drive workspace attachment
-- Allows a workspace to attach a Google Drive folder (per workspace, like GA4
-- / Search Console) so assets can live off-site in the owner's Drive instead
-- of only in the platform's storage bucket.

DO $$
DECLARE
    con_name TEXT;
BEGIN
    -- Drop whatever name Postgres auto-assigned to the inline CHECK.
    SELECT conname INTO con_name
    FROM pg_constraint
    WHERE conrelid = 'public.tenant_connections'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%google_analytics%'
    LIMIT 1;
    IF con_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE public.tenant_connections DROP CONSTRAINT %I', con_name);
    END IF;
END $$;

ALTER TABLE tenant_connections
    ADD CONSTRAINT tenant_connections_provider_check
    CHECK (provider IN ('google_analytics', 'search_console', 'google_drive'));
