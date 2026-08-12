# AI Team + Team Accounts — Spec

Status: **v1 spec — Phase 1 (AI Team dashboard) in build**
Owner: Agency OS
Related: `src/app/help/page.tsx` (recovered roster), `src/lib/ai/orchestrator.ts`, `src/lib/seo/deployCampaign.ts`, `src/lib/supabase/tenant-scope.ts`

## 1. Vision

Every agency tenant gets a team of **named AI employees** (the Marblism-inspired roster,
renamed + repivoted for agencies, expanded from 6 to 11). Employees run the agency's
day-to-day work — content, socials, leads, SEO, voice, publishing, analytics, reputation —
as background modules, workers, and integrations.

Two commercial modes:

1. **Individual / granular** (existing plans): hire specific AI employees à la carte and use
   their tools directly (Cheryl → Generate, Pam → Calendar/Social, AK → SEO, …).
2. **Team Accounts** (new, higher price point): the tenant's human team (multi-seat) shares a
   **team drive** (storage), **projects/campaigns**, and a **project & campaign manager
   (Malory)** who orchestrates the whole AI team against each client campaign.

## 2. Recovered roster — 11 AI employees

| Key | Name | Role | Status (backend) | Backed by |
|---|---|---|---|---|
| penny | Cheryl | SEO Content Writer | built | AI orchestrator (`/api/generate-content`, `generate-image`) |
| eva | Woodhouse | Executive Assistant (inbox & calendar) | built (replies/IMAP planned) | `/api/inbox/emails`, calendar sync, Gmail/Outlook OAuth |
| sonny | Pam | Social Media Manager | built | `/api/calendar`, `/api/publish`, `/api/inbox/social`, Meta API |
| stan | Barry | Lead Generation | built | `/api/leads`, `/api/sequences`, Apollo, Resend, Twilio |
| rachel | Brett | Receptionist | built (dashboard UI planned) | `/api/voice/*`, TwiML webhooks |
| scout | AK | Technical SEO Auditor | built | `/api/seo`, site crawler, competitor discovery |
| dev | Ray | Web Developer | built (Webflow planned) | `/api/publish`, WordPress API |
| gauge | Sterling | Performance Marketer | built (Meta/X reporting planned) | analytics workers (`fetch-analytics` Inngest) |
| nina | Malory | Project Manager | built (tasks/sequences) | Inngest workers, `/api/tasks/blog-generation` |
| juno | Lana | Reputation Manager | partial (GBP connect; reviews planned) | `/api/settings/gbp`, Google Business Profile |
| linda | Cyril | Legal Assistant | planned | — |

## 3. Data model

### 3.1 Catalog + tenant hiring (Phase 1)

```sql
ai_employees (catalog, seeded):
  id            uuid pk
  key           text unique          -- 'penny', 'stan', ...
  name          text                 -- display name
  role          text                 -- 'SEO Content Writer'
  description   text
  status        text                 -- 'built' | 'partial' | 'planned'
  integrations  text                 -- 'DeepSeek, OpenAI, AI orchestrator'
  settings_href text                 -- deep link to the tool/settings page
  icon          text                 -- lucide icon key
  sort_order    int

tenant_ai_employees (per-tenant hiring):
  id            uuid pk
  tenant_id     uuid fk tenants
  employee_id   uuid fk ai_employees
  hired         boolean default true -- 'hired' = visible in the team UI
  active        boolean default true -- 'active' = enabled to run work
  hired_at      timestamptz
  metadata      jsonb                -- per-tenant tweaks
  UNIQUE (tenant_id, employee_id)
```

Seeding: on migration, all 11 catalog rows are inserted. Tenants get `tenant_ai_employees`
rows lazily on first dashboard load (or seeded for existing tenants in the migration —
simple `INSERT … SELECT`).

### 3.2 Team Accounts (Phases 3–4)

```sql
team_drives / storage:
  -- Reuses media_assets + a provider column ('vps' | 'gdrive' | 'external')
  -- Each tenant's storage root = tenant-scoped folder on the VPS (or their
  -- connected Google Drive later). 'shared drive' = any tenant member (or AI
  -- employee) can read/write the team's assets.

projects (the shared campaign unit):
  id            uuid pk
  tenant_id     uuid fk
  workspace_id  uuid fk workspaces
  client_id     uuid fk clients (nullable — agency-internal projects allowed)
  name          text
  status        text  -- 'active' | 'paused' | 'completed' | 'archived'
  goals         jsonb -- targets: traffic, leads, rankings, deliverables
  start_date    date
  end_date      date
  nina_plan     jsonb -- Malory's generated task plan (steps, milestones, owners)

project_assignments (which AI employee works on which project):
  id            uuid pk
  project_id    uuid fk projects
  employee_key  text  -- 'scout', 'penny', ...
  task          text  -- 'technical audit', 'monthly content', ...
  status        text  -- 'todo' | 'in_progress' | 'done' | 'blocked'
  notes         jsonb
  UNIQUE (project_id, employee_key, task)
```

`seo_campaigns` gains a nullable `project_id` so approved proposals become project
artifacts. `posts`, `leads`, `site_audits`, `analytics_snapshots` stay as the work
products; the project board reads them per project via `project_assignments` + metadata.

### 3.3 Multi-tenant

All new tables carry `tenant_id` and are accessed ONLY via `tenantScopedClient` (see
`src/lib/supabase/tenant-scope.ts`). The isolation audit script
(`scripts/audit-tenant-scope.cjs`) is extended to cover the new tables.

## 4. Pages

### Phase 1 — AI Team dashboard (`/dashboard/ai-team`)
- Roster grid of all 11 employees: avatar/icon, name, role, backend status badge
  (Built / Partial / Planned), integrations, description.
- **Hire / fire** toggle per employee (writes `tenant_ai_employees`).
- **Deep links**: each card links to its tool/settings page (Cheryl → `/dashboard/settings/ai`,
  AK → `/dashboard/seo`, Pam → `/dashboard/settings/social`, Ray →
  `/dashboard/settings/blog`, Lana → `/dashboard/settings/gbp`, …).
- Per-employee **activity snapshot** where data exists (e.g. Cheryl → recent generated
  posts; Barry → open leads; Sterling → latest snapshot; Brett → recent calls).

### Phase 2 — Individual tool UIs (close the gaps)
- **Woodhouse**: Inbox UI (`/dashboard/inbox`) over `/api/inbox/emails` — read, triage, calendar.
- **Barry**: Leads + Sequences UI (`/dashboard/leads`) over `/api/leads` + `/api/sequences`.
- **Brett**: Call log UI (`/dashboard/voice`) over `/api/voice/calls`.
- **Sterling**: Analytics view over `analytics_snapshots`.
- **Lana**: Review monitoring UI over Google Business Profile.

### Phase 3 — Team Accounts
- **Billing**: new `team` plan (higher price, multi-seat). `licenses.seats_total` controls
  the team size; plan gates team features (shared drive, projects, Malory).
- **Team page** (`/dashboard/team`): invite humans (email + role) → `user_roles` row.
- **Projects** (`/dashboard/projects` + `/dashboard/projects/[id]`): create a project for a
  client; **Malory** generates the plan; each assignment row shows its AI employee, status,
  and links to the produced work.
- **Shared drive**: storage UI (`/dashboard/drive`) over tenant-scoped VPS storage;
  `media_assets.provider` column ('vps'). Later: connect a Google Drive (master
  service-account model) per tenant.

### Phase 4 — Malory, the campaign manager
- Creating a project triggers Malory: onboarding → audit (AK) → content plan (Cheryl) →
  publishing (Ray) → social (Pam) → leads (Barry) → analytics (Sterling) → reputation
  (Lana) — the case-study flow already documented in `/help`.
- Malory tracks statuses via `project_assignments`, creates `seo_campaigns` from AK's
  audit, schedules posts via the calendar, and reports progress on the project board.

## 5. Pricing shape

| | Individual (existing) | Team (new) |
|---|---|---|
| Human seats | 1–3 | 3+ (seats_total) |
| AI employees | hire à la carte | full team included |
| Shared drive | — | included (tenant-scoped storage) |
| Projects + Malory | single campaigns | unlimited projects, Malory orchestrates |
| Price | Starter / Growth / Dominance | **Team** tier (higher) |

## 6. Build order

1. **Phase 1**: catalog + tenant_ai_employees + AI Team dashboard (in build)
2. **Phase 2**: individual tool UIs (Inbox, Leads, Voice, Analytics, Reputation)
3. **Phase 3**: team plan billing + team page + projects + shared drive
4. **Phase 4**: Malory campaign-manager orchestration
