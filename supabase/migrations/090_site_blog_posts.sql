-- 090 — site blog posts
--
-- WordPress-style blog for the marketing site (the super admin's own site at
-- the root domain). Global — NOT tenant-scoped: these posts render on the
-- public landing site at /blog/<slug>, not inside any client workspace.
-- Only the super admin can create/edit/delete posts (enforced in the API
-- layer with requireRole("super_admin")).

CREATE TABLE IF NOT EXISTS site_blog_posts (
    id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    slug               TEXT NOT NULL UNIQUE,
    title              TEXT NOT NULL,
    excerpt            TEXT,
    body               TEXT NOT NULL DEFAULT '',
    featured_image_url TEXT,
    status             TEXT NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft', 'published')),
    published_at       TIMESTAMPTZ,
    created_at         TIMESTAMPTZ DEFAULT now(),
    updated_at         TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_site_blog_posts_status
    ON site_blog_posts (status, published_at DESC);
