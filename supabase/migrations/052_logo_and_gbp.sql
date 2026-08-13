-- 052 — site logo + Google Business Profile enrichment
ALTER TABLE cms_site_settings
    ADD COLUMN IF NOT EXISTS logo_url TEXT;

ALTER TABLE google_business_profiles
    ADD COLUMN IF NOT EXISTS account_email TEXT,
    ADD COLUMN IF NOT EXISTS location_name TEXT;
