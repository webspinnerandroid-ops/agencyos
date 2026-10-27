-- Migration: 115_site_page_design_tokens — per-page design tokens (accent color,
-- font stack, corner radius) for the CMS page renderer.
--
-- The Web Builder's "Design tokens" panel (cms/page.tsx) writes these through
-- PATCH /api/cms/pages/[id], and the public renderer /site/[slug] reads the
-- column and turns it into CSS via renderTokenStyles(). The feature shipped in
-- code without a migration, so every /site/<slug> render 404'd with
-- "column site_pages.tokens does not exist" — also breaking theme settings
-- application (e.g. Dark & Sleek) on published pages.

ALTER TABLE site_pages
    ADD COLUMN IF NOT EXISTS tokens JSONB NOT NULL DEFAULT '{}'::jsonb;
