-- 095: Add category and tags to site_blog_posts for blog archive filtering.

ALTER TABLE site_blog_posts
  ADD COLUMN IF NOT EXISTS category text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS tags text[] DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_site_blog_posts_category
  ON site_blog_posts (category)
  WHERE category IS NOT NULL AND status = 'published';

CREATE INDEX IF NOT EXISTS idx_site_blog_posts_tags
  ON site_blog_posts USING gin (tags)
  WHERE status = 'published';
