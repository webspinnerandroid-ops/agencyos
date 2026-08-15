# AI Team Chat + Automated Campaign Workflow

Two connected features that turn Agency OS from "tools" into the set-and-forget
AI agency you planned:

1. **AI Team Chat** — a chat instance per *team × workspace × client*, where you
   talk to Cheryl, Woodhouse, Pam, Barry, Brett, AK, Ray, Sterling, Malory,
   Lana and Cyril like coworkers (a "meet your team" feel — but a real
   chat, not static cards).
2. **Campaign Workflow Engine** — the ideal agency pipeline runs end-to-end with
   the team: onboarding → audit → proposal → approval → auto-configure → content
   (blogs, images, videos) → review → schedule → publish. Lazy-proof defaults
   ("set and forget") with full manual override for power users.

---

## Part 1 — AI Team Chat

### Concept

Every employee already has real backend capability (orchestrator, inbox, social,
leads, voice, SEO, publishing, analytics, task queues). Chat is the front door:
one conversation where you can ask questions, request work, and watch it happen.
The chat routes to the right employee automatically (Malory dispatches) or you
DM an employee directly.

### Data model (migration 022)

```sql
-- A chat room. Scoped by tenant (isolation) and optionally workspace + client.
CREATE TABLE team_chats (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,   -- nullable = all workspaces
    client_id    UUID REFERENCES clients(id) ON DELETE CASCADE,      -- nullable = all clients
    title        TEXT NOT NULL DEFAULT 'Team Chat',
    kind         TEXT NOT NULL DEFAULT 'team' CHECK (kind IN ('team','employee')),
    employee_key TEXT,           -- non-null when kind='employee' (Cheryl, Woodhouse, ...)
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, workspace_id, client_id, kind, employee_key)
);

CREATE TABLE team_messages (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_id      UUID NOT NULL REFERENCES team_chats(id) ON DELETE CASCADE,
    tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    role         TEXT NOT NULL CHECK (role IN ('user','employee','system')),
    employee_key TEXT,           -- which employee authored (null for user/system)
    content      TEXT NOT NULL,
    metadata     JSONB DEFAULT '{}'::jsonb,  -- tool calls, post ids, asset urls, step refs
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_team_chats_tenant    ON team_chats (tenant_id);
CREATE INDEX idx_team_messages_chat   ON team_messages (chat_id, created_at);
CREATE INDEX idx_team_messages_tenant ON team_messages (tenant_id);
```

RLS: tenant-isolation policy identical to `tenant_ai_employees`; all server
access via the enforced `tenantScopedClient` from the isolation hardening.

### Chat surfaces

- **Team Room** (`/dashboard/ai-team/chat`) — Malory dispatches. Natural
  language in, work out: *"Draft a launch blog for Coal Creek, generate 3
  images, and schedule it Friday"* → Malory plans, Cheryl writes, images get
  generated, Ray/Danny schedule. Every step appears as a message with links to
  the created post/asset.
- **Employee DMs** — per-employee rooms; the persona system-prompt is the
  employee's description + capability guide, backed by the real underlying
  tool (Cheryl → orchestrator, Woodhouse → inbox/calendar, Barry → leads,
  Brett → voice, AK → SEO, Ray → publishing, Sterling → analytics,
  Lana → GBP, Cyril → legal drafting).
- **Context-aware** — each room is scoped to a workspace/client, so the team
  already knows the brand voice, knowledge base, and client when you ask.

### Response engine

`POST /api/ai-team/chat` — role-aware, tenant-scoped, rate-limited:
1. Insert user message.
2. Route (Malory dispatch or direct employee).
3. Call the orchestrator with the employee's persona prompt + workspace context
   (brand profile + knowledgebase, same enrichment as generate-content).
4. For actionable intents, invoke the real tools (generate-content, generate-image,
   schedule, publish) via existing routes — the chat is a *front end to the
   existing backend*, not a parallel system.
5. Insert assistant message with metadata (post ids, asset ids) and return.

---

## Part 2 — Campaign Workflow Engine

### The ideal pipeline (the "sample workflow")

| Step | Who | What happens | Auto? |
|---|---|---|---|
| 1. Onboard | Malory + Woodhouse | Create client, workspace, brand profile from a form or chat ("set up Coal Creek") | ✅ default |
| 2. Audit | AK | Crawl site, competitor discovery, technical SEO issues | ✅ on demand |
| 3. Proposal | AK + Cheryl | Build the SEO proposal tiers from the audit; store in `seo_campaigns` (existing) | ✅ from audit |
| 4. Sale/Approval | User + client | Client approves a tier in the white-label portal (`/seo/proposal`) | human gate |
| 5. Auto-configure | Malory | On approval: read the approved campaign_json → create the campaign plan (topics, schedule, platforms, publishing connections) | ✅ **the magic step** |
| 6. Generate | Cheryl + team | Generate blog posts + images (existing pipeline, now storage-backed), social captions, video scripts | ✅ scheduled by Malory |
| 7. Review | User | Drafts land in the dashboard/portal for approval (existing review flow) | optional gate |
| 8. Schedule/Publish | Malory + Ray + Pam | Schedule to calendar; publish to WordPress/socials via existing publishers | ✅ default |

### Data model (migration 023)

```sql
CREATE TABLE campaigns (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    client_id      UUID REFERENCES clients(id) ON DELETE CASCADE,
    seo_campaign_id UUID REFERENCES seo_campaigns(id) ON DELETE SET NULL,
    workspace_id   UUID REFERENCES workspaces(id) ON DELETE SET NULL,
    name           TEXT NOT NULL,
    status         TEXT NOT NULL DEFAULT 'planned'
                   CHECK (status IN ('planned','active','paused','completed')),
    settings       JSONB DEFAULT '{}'::jsonb,   -- cadence, platforms, word targets
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE campaign_steps (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id  UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    step_type    TEXT NOT NULL,   -- audit|proposal|content|images|video|schedule|publish|review
    status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','in_progress','done','failed','skipped')),
    config       JSONB DEFAULT '{}'::jsonb,     -- topics, counts, schedule
    output       JSONB DEFAULT '{}'::jsonb,     -- post ids, asset ids, urls
    started_at   TIMESTAMPTZ,
    finished_at  TIMESTAMPTZ,
    error        TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_campaigns_tenant   ON campaigns (tenant_id);
CREATE INDEX idx_campaign_steps_camp ON campaign_steps (campaign_id);
```

### The setup wizard (gather → auto-configure)

The workflow starts as a **wizard** (`/dashboard/campaigns/new`) that walks the
owner through gathering everything once, so the team can run set-and-forget:

1. **Client basics** — name, industry, website, location
2. **Brand assets** — logo, colors, brand voice, knowledge-base upload (existing
   workspace/brand-profile features)
3. **Goals** — traffic / leads / brand awareness, content mix (blogs, images,
   video)
4. **Tier** — pick a plan or wire the approved proposal
5. **Publishing** — connect WordPress / social accounts (existing settings)
6. **Cadence** — posting frequency, best days, review-before-publish toggle

On **Finish**, Malory auto-configures: creates the campaign, runs AK's audit,
builds the proposal or reads the approved one, and enqueues generation. The
owner can also start from *just a URL* — the team gathers the rest itself.

### Execution

- **Inngest jobs** (already proven live on the VPS): `campaign-run` walks
  pending steps in order; each step calls the same routes/workers the UI uses
  (generate-content, generate-image, publishScheduledPosts, syncSocialInbox).
- **Malory owns the plan**: on approval, she derives the content calendar from
  the approved proposal's tier (e.g. Gold = 4 posts/mo + 12 socials) and
  enqueues the generation jobs — no human needed.
- **Status visible everywhere**: campaign dashboard with step progress; chat
  messages announce each step's completion ("Cheryl published 'Why Can't We Be
  Friends?' to Coal Creek's WordPress — next post Friday").

---

## Phasing

1. **Phase 1 — Chat foundation**: migration 022, `src/lib/ai-team-chat.ts`
   (tenant-scoped actions), `POST /api/ai-team/chat` (Malory dispatch + Cheryl
   persona first), `/dashboard/ai-team/chat` UI (Team Room + employee DMs).
   *Deliverable: talk to your team, ask for a blog, get it generated + linked.*
2. **Phase 2 — Chat tool actions**: wire every employee persona to its real
   backend (inbox, leads, voice, SEO, publishing, analytics), message metadata
   with post/asset links.
3. **Phase 3 — Workflow engine**: migrations 023, campaign CRUD UI
   (`/dashboard/campaigns`), Inngest `campaign-run`, the approval →
   auto-configure handoff from `seo_campaigns`.
4. **Phase 4 — Video + set-and-forget polish**: video script/planning steps,
   publishing connectors, per-campaign settings with sensible defaults,
   "watch it run" campaign dashboard.
