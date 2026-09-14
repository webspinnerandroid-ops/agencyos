-- ============================================================================
-- Migration: 101_content_map
--
-- Bulk content planning: an agency uploads a CSV of a year's worth of content
-- ideas (Title, Keywords, Topic, Type, Platforms) per client — the "content
-- map". Each row becomes a content_map_item that can be generated later with
-- the full quality gate (SEO + AEO/GEO >= gate) and images, then lands as a
-- normal draft post ready for the scheduling/publishing pipeline.
--
-- content_map_imports records each upload (filename, brand voice used, row
-- count) so the map's provenance is auditable. Brand voice is set once per
-- import — it applies to every row in that upload.
--
-- RLS follows the platform pattern (097/098): the tables are never touched
-- directly from the browser — every read/write goes through API routes using
-- the service client with explicit tenant_id scoping — so policies deny all
-- direct access.
-- ============================================================================

CREATE TABLE IF NOT EXISTS content_map_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  -- One brand voice for the whole upload (the map-level setting).
  brand_voice TEXT,
  filename TEXT,
  row_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS content_map_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  import_id UUID REFERENCES content_map_imports(id) ON DELETE SET NULL,
  -- Where the row came from in the uploaded CSV (1-based data-row number).
  source_row INT,
  title TEXT NOT NULL,
  -- keywords[0] is the FOCUS keyword; the rest are secondary.
  keywords TEXT[] NOT NULL DEFAULT '{}',
  topic TEXT,
  -- 'blog' | 'social' — social rows still generate a blog seed post with
  -- captions for the row's platforms (the pipeline's social captions are
  -- derived from a blog).
  content_type TEXT NOT NULL DEFAULT 'blog',
  platforms TEXT[] NOT NULL DEFAULT '{}',
  -- Soft warnings from the import ("no keywords…", "unknown platform dropped")
  -- so the map can show what was auto-corrected per row.
  import_note TEXT,
  -- planned    → waiting to be generated
  -- generating → a generation is in flight for this row
  -- done       → linked_post_id points at the gated draft post
  -- failed     → generation failed (error holds the reason, e.g. gate miss)
  -- dismissed  → hidden from the default view
  status TEXT NOT NULL DEFAULT 'planned',
  linked_post_id UUID REFERENCES posts(id) ON DELETE SET NULL,
  -- The quality-gate story of the generated post (gate, attempts, history) —
  -- copied from the generate-content response so the map shows the same
  -- "cleared on attempt N" badge as the results card.
  gate JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_content_map_items_tenant_ws
  ON content_map_items (tenant_id, workspace_id);
CREATE INDEX IF NOT EXISTS idx_content_map_items_client
  ON content_map_items (client_id);
CREATE INDEX IF NOT EXISTS idx_content_map_items_status
  ON content_map_items (status);

ALTER TABLE content_map_imports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "no_direct_access" ON content_map_imports;
CREATE POLICY "no_direct_access" ON content_map_imports FOR ALL USING (false);

ALTER TABLE content_map_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "no_direct_access" ON content_map_items;
CREATE POLICY "no_direct_access" ON content_map_items FOR ALL USING (false);
