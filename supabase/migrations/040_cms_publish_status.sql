-- 040 — track when a post has been published to the tenant's own CMS website.
-- Lets content lists show an "On site" badge with a link to the live page.

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS cms_published_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cms_slug TEXT;

-- Existing posts already published as blog_post pages on the site: backfill
-- the flag from site_pages so the badge shows immediately (match by title,
-- which is stored verbatim on both sides).
UPDATE posts p
SET cms_published_at = sp.published_at,
    cms_slug         = sp.slug
FROM site_pages sp
WHERE sp.kind = 'blog_post'
  AND sp.tenant_id = p.tenant_id
  AND sp.is_published = true
  AND sp.title = p.title;
