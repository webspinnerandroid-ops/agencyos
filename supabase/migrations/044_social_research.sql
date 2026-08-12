-- 044 — social presence research stored with SEO campaigns.
-- AI-assisted estimates of which social platforms the site + competitors use
-- and how active they are, so proposals ground their social strategy in data.

ALTER TABLE seo_campaigns
  ADD COLUMN IF NOT EXISTS social_research_json JSONB;
