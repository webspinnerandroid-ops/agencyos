-- ============================================================================
-- Migration: 019_ai_team
-- Description:
--   The AI Team. A catalog of named AI employees (Cheryl, Woodhouse, Pam, Barry,
--   Brett, AK, Ray, Sterling, Malory, Lana, Cyril) plus a per-tenant join table
--   for hiring/activating them. The employees' actual work already exists as
--   backend libs, API routes, and Inngest workers — this adds the roster the
--   dashboard UI is built on.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. ai_employees — the catalog (global, not tenant-scoped)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_employees (
    id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    key           TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL,
    role          TEXT NOT NULL,
    description   TEXT,
    status        TEXT DEFAULT 'built' CHECK (status IN ('built', 'partial', 'planned')),
    integrations  TEXT,
    settings_href TEXT,
    icon          TEXT,
    sort_order    INT  DEFAULT 0
);

-- ----------------------------------------------------------------------------
-- 2. tenant_ai_employees — per-tenant hiring/activation
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenant_ai_employees (
    id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id   UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES ai_employees (id) ON DELETE CASCADE,
    hired       BOOLEAN NOT NULL DEFAULT TRUE,
    active      BOOLEAN NOT NULL DEFAULT TRUE,
    hired_at    TIMESTAMPTZ DEFAULT now(),
    metadata    JSONB DEFAULT '{}'::jsonb,
    UNIQUE (tenant_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_tenant_ai_employees_tenant ON tenant_ai_employees (tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_ai_employees_employee ON tenant_ai_employees (employee_id);

ALTER TABLE tenant_ai_employees ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY "tenant_isolation" ON tenant_ai_employees
        FOR ALL USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ----------------------------------------------------------------------------
-- 3. Seed the catalog (idempotent)
-- ----------------------------------------------------------------------------
INSERT INTO ai_employees (key, name, role, description, status, integrations, settings_href, icon, sort_order)
VALUES
  ('penny', 'Cheryl', 'SEO Content Writer',
   'Writes SEO-optimized blog posts, social captions, and content from the AI orchestrator (DeepSeek / OpenAI models). Constantly unhinged and dramatic — churns out chaotic streams of consciousness that somehow get results.',
   'built', 'DeepSeek, OpenAI, AI orchestrator', '/dashboard/settings/ai', 'PenTool', 1),
  ('eva', 'Woodhouse', 'Executive Assistant (Inbox & Calendar)',
   'Connects Gmail or Outlook via OAuth, reads and triages unread email, syncs your calendar, and creates events. Timeless, deeply long-suffering, entirely accustomed to managing schedules under endless abuse. Drafting/replies and IMAP/POP are on the roadmap.',
   'built', 'Gmail OAuth, Outlook / Microsoft Graph', '/dashboard/settings', 'MessagesSquare', 2),
  ('sonny', 'Pam', 'Social Media Manager',
   'Connects Facebook & Instagram (OAuth), schedules and posts to social platforms, and manages the social inbox via background workers. Loud, loves the spotlight, and handles public relations with zero filter.',
   'built', 'Facebook, Instagram, Meta API', '/dashboard/settings/social', 'Users2', 3),
  ('stan', 'Barry', 'Lead Generation',
   'Captures and imports leads (including Apollo enrichment), sends outbound email via Resend, SMS via Twilio, and runs automated follow-up sequences. Relentless, aggressive, laser-focused on hunting down targets.',
   'built', 'Apollo, Resend, Twilio, sequences', '/dashboard/settings', 'Zap', 4),
  ('rachel', 'Brett', 'Receptionist',
   'Handles inbound and outbound phone calls via the voice agent (TwiML webhooks). A call-management dashboard UI is planned. Perpetually caught in the line of fire as the primary target for everything going wrong.',
   'built', 'Twilio / telephony webhooks', '/dashboard/settings', 'PhoneCall', 5),
  ('scout', 'AK', 'Technical SEO Auditor',
   'Crawls websites, finds technical and on-page SEO issues, and discovers competitor domains for your campaigns. Obsessed with bizarre hidden mechanics and performing questionable experiments behind closed doors.',
   'built', 'Site crawler, competitor analysis', '/dashboard/seo', 'Globe', 6),
  ('dev', 'Ray', 'Web Developer',
   'Publishes content and web changes to WordPress sites. Webflow publishing is planned. Constantly dealing with broken infrastructure, putting out fires, and complaining about how underappreciated his technical work is.',
   'built', 'WordPress API (Webflow planned)', '/dashboard/settings/blog', 'Search', 7),
  ('gauge', 'Sterling', 'Performance Marketer',
   'Pulls engagement analytics via background workers. Meta Insights / X Analytics reporting is planned. Operates on raw ego and reckless luck, with a total disregard for ROI until it somehow works out.',
   'built', 'Analytics workers, Meta/X (planned)', '/dashboard/analytics', 'TrendingUp', 8),
  ('nina', 'Malory', 'Project Manager',
   'Processes scheduled tasks and follow-up sequences, coordinates blog-generation tasks, and keeps deliverables on track. Runs a tight, highly toxic ship with an iron fist and a martini in hand.',
   'built', 'Inngest workers, task queues', '/dashboard/calendar', 'Briefcase', 9),
  ('juno', 'Lana', 'Reputation Manager',
   'Manages Google Business Profile connections. Review monitoring and response automation are planned. Constantly doing damage control and yelling about how everyone else is ruining the brand.',
   'partial', 'Google Business Profile', '/dashboard/settings/gbp', 'Star', 10),
  ('linda', 'Cyril', 'Legal Assistant',
   'Planned — drafts contracts, answers legal questions, and clarifies fine print for your agency and clients. Chronically nervous, deeply insecure, one minor spreadsheet error away from a complete psychological breakdown.',
   'planned', 'AI drafting (planned)', '/dashboard/settings', 'Wrench', 11)
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  role = EXCLUDED.role,
  description = EXCLUDED.description,
  status = EXCLUDED.status,
  integrations = EXCLUDED.integrations,
  settings_href = EXCLUDED.settings_href,
  icon = EXCLUDED.icon,
  sort_order = EXCLUDED.sort_order;

-- ----------------------------------------------------------------------------
-- 4. Backfill: every existing tenant "hires" the full team by default so the
--    roster shows up immediately. Later hires are per-tenant toggles.
-- ----------------------------------------------------------------------------
INSERT INTO tenant_ai_employees (tenant_id, employee_id, hired, active)
SELECT t.id, e.id, TRUE, TRUE
FROM tenants t
CROSS JOIN ai_employees e
ON CONFLICT (tenant_id, employee_id) DO NOTHING;
