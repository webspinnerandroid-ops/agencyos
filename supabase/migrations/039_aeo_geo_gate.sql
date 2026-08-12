-- Migration: 039_aeo_geo_gate
--
-- Score-based publish gate now covers BOTH the Rank Math-style SEO score and
-- the AEO/GEO readiness score, and below-threshold blogs are auto-rewritten
-- through Cheryl's pipeline (guarded to a max of 2 rewrites per post so a
-- stubborn keyword can't loop forever).

-- Combined readiness score: lower of seo_score and aeo_geo_score is used as
-- the publish gate threshold (a post must clear BOTH bars).
ALTER TABLE posts ADD COLUMN IF NOT EXISTS aeo_geo_score NUMERIC;

-- How many times the auto-rewrite has already run for this post.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS auto_rewrite_count INT NOT NULL DEFAULT 0;
