-- Migration: 024_campaign_plans — Malory's mapped-out campaigns as a calendar.
--
-- When the owner asks the team to "plan a campaign", Malory produces a
-- structured plan (title + dated blog/social items) that is saved here and
-- surfaced on the Content Calendar as "proposed" items alongside the posts
-- table's draft/scheduled/published content.

CREATE TABLE IF NOT EXISTS campaign_plans (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    workspace_id UUID REFERENCES workspaces (id) ON DELETE CASCADE,
    client_id    UUID REFERENCES clients (id) ON DELETE CASCADE,
    title        TEXT NOT NULL,
    summary      TEXT NOT NULL DEFAULT '',
    status       TEXT NOT NULL DEFAULT 'proposed'
                 CHECK (status IN ('proposed', 'active', 'completed', 'archived')),
    created_by   TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS campaign_plan_items (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id        UUID NOT NULL REFERENCES campaign_plans (id) ON DELETE CASCADE,
    tenant_id      UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    kind           TEXT NOT NULL CHECK (kind IN ('blog', 'social')),
    topic          TEXT NOT NULL,
    due_date       DATE NOT NULL,
    platform       TEXT,
    -- Which AI employee executes this piece (Cheryl for blogs, Pam for
    -- socials, etc.) — Malory assigns owners when she maps the plan.
    owner          TEXT,
    status         TEXT NOT NULL DEFAULT 'proposed'
                   CHECK (status IN ('proposed', 'draft', 'scheduled', 'published', 'dropped')),
    linked_post_id UUID REFERENCES posts (id) ON DELETE SET NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaign_plans_tenant ON campaign_plans (tenant_id);
CREATE INDEX IF NOT EXISTS idx_campaign_plans_scope  ON campaign_plans (tenant_id, workspace_id);
CREATE INDEX IF NOT EXISTS idx_campaign_items_plan   ON campaign_plan_items (plan_id, due_date);
CREATE INDEX IF NOT EXISTS idx_campaign_items_tenant ON campaign_plan_items (tenant_id);

ALTER TABLE campaign_plans      ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_plan_items ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    CREATE POLICY "tenant_isolation" ON campaign_plans
        FOR ALL USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE POLICY "tenant_isolation" ON campaign_plan_items
        FOR ALL USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
