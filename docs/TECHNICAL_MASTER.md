# Agency OS — Technical Master Document

> **Purpose:** a single, complete reference for developers and technicians working on
> Agency OS: architecture, data model, every feature and function, AI team, scoring,
> background jobs, billing, deployment, and security. Last updated with the codebase
> at commit `34a17e0` + the usage/API-registry batch.

---

## 1. What this is

Agency OS is a multi-tenant SaaS "AI agency in a box": it sells subscription plans that
give each tenant a full **AI employee team**, plus tools to run the entire client-agency
workflow — SEO audits, proposals, e-signature, campaign planning, content + image + video
generation, scheduling, publishing, a website builder (CMS), social outreach, and
analytics.

- **Frontend/backend:** Next.js 16 (App Router, React Server Components where sensible)
- **Database/auth/storage:** Supabase (Postgres + PostgREST + Auth + Storage)
- **Background jobs:** Inngest (self-hosted serve endpoint at `/api/inngest`)
- **Payments:** Stripe (subscriptions, coupons/discounts)
- **Email:** Resend (transactional + outreach; inbound webhook for reply watching)
- **Media CDN:** Bunny.net storage + CDN (image/video uploads)
- **Deployment:** VPS behind a reverse proxy, PM2, full-sync deploy script
- **AI providers:** DeepSeek, OpenAI, Google (Gemini/Imagen), fal.ai (Wan video),
  Runway, ElevenLabs, plus a registry of ~38 providers/models

---

## 2. Repository layout

```
agency-os/
  src/
    app/                 # Next.js App Router pages + API routes
      api/               #   all server endpoints (see §8)
      dashboard/         #   authenticated app (see §7)
      seo/proposal/      #   public client proposal page
      site/[slug]/       #   public CMS-published pages (tenant websites)
      login, register, ...# public auth/marketing pages
    components/          # shared React components (ui/, NavDropdown, PublishButton…)
    lib/                 # server libraries (see §3)
    proxy.ts             # Next 16 middleware: auth + PUBLIC_ROUTES allowlist
  supabase/migrations/   # 001–044 SQL migrations (idempotent; run in SQL Editor)
  scripts/               # maintenance/ops scripts (sanitize, audits, seeds)
  deploy-*.cjs           # VPS deploy scripts (deploy-full-sync.cjs is the current one)
  docs/                  # this document
```

**Key conventions**

- Server code touches the DB only via `createServiceClient()` (service-role key) or
  the anonymous/authenticated client — never with a raw connection string in the app.
- Every tenant-scoped query **must** filter by `tenant_id`; `scripts/audit-tenant-scope.cjs`
  audits this automatically and is part of the pre-commit checks.
- API keys stored by tenants are **encrypted at rest** (`src/lib/encryption.ts`, AES-GCM
  with `ENCRYPTION_KEY`) in `tenant_api_keys.encrypted_key` (BYTEA). Keys are never
  returned to the client — only a masked last-4 label.
- Migrations are applied manually in the Supabase SQL Editor (idempotent, safe to re-run).
  There is no automated migration runner on the VPS.

---

## 3. Server libraries (`src/lib`)

| Module | Purpose |
|---|---|
| `auth.ts` | Session helpers: `getTenantId()`, `getUserId()`, `requireRole()`, `isSuperAdmin()` |
| `tenant.ts` | Tenant resolution, workspace/tenant relationships |
| `workspace.ts` | `getCurrentWorkspaceId()` (cookie-driven via proxy) |
| `supabase/server.ts` | `createServiceClient()` (service-role) + public client helpers |
| `encryption.ts` | AES-GCM encrypt/decrypt for tenant API keys and 2FA secrets |
| `rate-limit.ts` | In-memory rate limiter (`rateLimitRequest`) used on public/expensive endpoints |
| `usage.ts` | Billing-cycle usage counters (`incrementUsage`, `getCurrentUsage`) |
| `plan-limits.ts` | Per-tier monthly limits (`PLAN_LIMITS`) + `checkUsageLimit` enforcement |
| `trial-limits.ts` | Free-trial weekly caps (1 per content type per week) |
| `notifications.ts` | App notifications (dashboard bell / reply alerts) |
| `post-preview.ts` | Lightweight post list/detail projections (no heavy JSON bodies) |
| `knowledgebase.ts` | Workspace knowledge base: folders, items (URLs scraped, text, docs), linkable pages, KB context |
| `brand-profile.ts` / `brand-profile-utils.ts` | Workspace brand profile + `buildBrandSystemPrompt` |
| `cms.ts` | CMS blocks, `renderBlocks` → HTML, blog-body rendering |
| `content-links.ts` | Internal-link resolution against real pages + "Related reading" |
| `blog-images.ts` | Image selection/specs for blogs (max 3, spaced, alternating wrap) |
| `seo-scorer.ts` | On-page SEO scoring engine (100-point, per-check) |
| `aeo-geo.ts` | AI Engine Optimization / Generative Engine Optimization scoring |
| `docusign.ts` | DocuSign envelope creation + signed-doc storage |
| `campaign-plans.ts` / `campaign-refine.ts` / `campaign-from-proposal.ts` | Campaign plan CRUD, Malory refine flow, proposal→campaign |
| `opportunity-scan.ts` | Weekly discovery of guest-post/reddit/linkedin/quora opportunities |
| `outreach/` | Guest-post outreach: discovery, targets, replies |
| `inbox/`, `voice/`, `media/`, `leads/`, `publishing/`, `seo/` | Feature modules (social inbox, voice, media assets, leads, publish connectors, SEO audit helpers) |
| `ai/` | Orchestrator, personas, prompts, team-task execution, workspace context |
| `inngest/` | Background-job client + function definitions |
| `totp.ts` | RFC 6238 TOTP (2FA) — dependency-free, validated against official vectors |
| `nav-sections.ts` | Shared dashboard navigation model (Work / Plan / Manage) |
| `aeo-geo.test.ts`, `seo-scorer.test.ts`, `totp.test.ts`, `blog-images.test.ts`, … | Vitest suites |

---

## 4. Data model (key tables)

Migrations are numbered `001`→`044` and are idempotent. The most important tables:

**Identity & tenancy**
- `auth.users` (Supabase managed) — user accounts
- `tenants` — one row per agency/client organization
- `user_roles` (`tenant_id`, `user_id`, `role`) — `owner`, `admin`, `member`, `super_admin`
- `subscriptions` (`tenant_id`, `plan_id`, `status`, `current_period_end`) — Stripe-linked
- `licenses` — seat/plan licenses (super-admin can toggle trial↔paid, renew without payment)
- `license_audit_log` — audit trail of license changes (migration 032)
- `coupon_codes` (042) — super-admin-issued discount codes applied at checkout
- `user_2fa` (043) — TOTP secret (encrypted) per user

**Workspaces & clients**
- `workspaces` — isolated per-campaign/client containers
- `clients` — client records (belong to tenant, optionally workspace)
- `brand_profiles` — per-workspace brand info for AI grounding
- `knowledgebase_folders` / `knowledgebase_items` — website/KB content (scraped URLs, text, docs)

**Content & campaigns**
- `posts` — blogs + social posts (`title`, `type`, `platform`, `status`, `content`,
  `seo_score`, `cms_published_at`, `cms_slug`, denormalized columns from 021)
- `media_assets` — images + videos (`type`, `status`, `prompt`, `url`, `metadata`,
  indexed by `idx_media_assets_recent_images`)
- `campaign_plans` (024) — Malory's mapped campaign roadmap
- `campaign_items` (026/027) — calendar entries with `owner` (employee key) + SEO context
- `seo_campaigns` — audits + tiers + proposals (`campaign_json`, `social_research_json` 044,
  location 029, docusign fields 030)
- `calendar_items` — scheduled/published items

**AI team & chat**
- `ai_employees` (019) — the 11 persona definitions
- `chat_rooms` (023) — per-workspace chat rooms
- `chat_messages` — messages (user/employee/system), `employee_key` routing
- `team_chat_tasks` — Inngest-driven agent task queue (concurrent agents)

**AI configuration**
- `ai_providers` — registry (~38 providers across text/image/video/voice/embedding/publishing)
- `ai_models` — model registry (`model_identifier`, `supported_tasks`, `is_deprecated`)
- `tenant_api_keys` — tenant-supplied provider keys (encrypted)
- `task_model_mappings` — tenant's per-task model choice
- `provider_balances` — balance snapshots + low-balance thresholds (038)

**CMS**
- `site_pages` (033) — pages/posts for the built-in website builder (`kind`: page, blog_post, blog_archive)
- `site_settings` (025/036) — global styles, site config

**Outreach & inbox**
- `outreach_targets` (036/041) — discovered guest-post opportunities + replies (`last_reply_at`, `reply_count`, `last_reply_seen`)
- `email_inboxes` / `social_inboxes` — connected inboxes (IMAP / social API)

**Other**
- `seo_score_history`, `rankings`, `backlinks` — SEO monitoring data
- `opportunities` — Reddit/LinkedIn/Quora recommendation opportunities
- `sequences` — automation sequences (processSequences job)
- `media_assets` metadata — video `mode` (t2v/i2v), `modelIdentifier`, resolution/codec chips

---

## 5. Authentication, multi-tenancy, RBAC

1. **Login** (`/api/auth/…`, `src/app/login/page.tsx`):
   - Password via Supabase Auth (`signInWithPassword`).
   - Unverified accounts are blocked with a **Resend confirmation** option
     (`/api/auth/resend-confirmation`).
   - If the user has 2FA enrolled, a TOTP step runs before the session is established
     (`/api/auth/2fa/*`: setup, verify, status, disable).
2. **Registration** (`/api/register`) — creates `auth.users` + tenant + owner role; the
   account must verify its email before first login.
3. **Proxy middleware** (`src/proxy.ts`) — Next 16 middleware. Sets the workspace cookie,
   enforces auth on `/dashboard/*` and `/api/*` except `PUBLIC_ROUTES`
   (login, register, reset, public `/site/*`, `/api/inngest`, webhooks like
   `/api/outreach/reply-webhook`, `/api/seo/…` proposal routes).
4. **RBAC** — `requireRole()` reads `user_roles` for the session user's tenant.
   `super_admin` gates admin pages: Admin, Coupons, APIs & Models, Deploy.
   *(Fixed: the admin gate previously compared `user_id` to `tenant_id` — never equal — so
   nobody could pass; now resolved via `getUserId()`.)*
5. **Tenant isolation** — every service-role data path filters by `tenant_id`
   (audited by `scripts/audit-tenant-scope.cjs`). Chat rooms, campaigns, media, KB,
   CMS pages, and outreach targets are all tenant+workspace scoped.

---

## 6. The AI team

11 employees, defined in `src/lib/ai/employee-personas.ts` (keys → names):

| Key | Name | Role | Specialized build |
|---|---|---|---|
| `penny` | Cheryl | SEO Content Writer | Full blog pipeline (research → outline → body → images → links → scoring) |
| `eva` | Woodhouse | Executive Assistant (inbox & calendar) | Inbox triage, scheduling |
| `sonny` | Pam | Social Media Manager | Social captions, approval pipeline |
| `stan` | Barry | Lead Generation | Lead hunting |
| `rachel` | Brett | Receptionist | Front-desk replies, intake |
| `scout` | AK | Technical SEO Auditor | Audit deep-dives |
| `dev` | Ray | Web Developer | Site/CMS build help |
| `gauge` | Sterling | Performance Marketer | Campaign/ROI planning |
| `nina` | Malory | Project Manager | Campaign mapping (full roadmap → calendar with owner chips), team dispatch, hand-offs |
| `juno` | Lana | Reputation Manager | Structured reputation-response pipeline (issue summary, ready-to-post response, tone rationale, red flags, escalate) |
| `linda` | Cyril | Legal Assistant | Legal-document pipeline (contracts/terms/NDAs/policies, placeholders, open questions, mandatory lawyer-review list) |

**Execution model**
- Chat per workspace (`chat_rooms`), threaded with history; agents remember the
  workspace's chat history.
- Requests are routed by `employee_key`; **Inngest `teamChatTask`** runs the agent
  work in the background queue, so Malory and Cyril can work concurrently in the same
  room while Cheryl drafts content.
- Personas are **expert-grade system prompts** (rules, output contracts, quality bars).
- Custom instructions/guidelines per employee are supported; brand + KB context
  (`loadWorkspaceContext`) grounds every reply.

---

## 7. App pages (`src/app/dashboard`)

**Nav model** (`src/lib/nav-sections.ts`): **Work / Plan / Manage** (shared by the
dashboard layout and the Help page when logged in).

| Route | Purpose |
|---|---|
| `/dashboard` | Home: quick actions, Recent Content (with CMS badge), Recent SEO Audits, outreach-replies card, **usage warning banner** |
| `/dashboard/profile` | Profile & Usage: plan, per-metric meters (blog/social/image/video/tokens), trial badge, social-by-platform breakdown |
| `/dashboard/ai-team` | AI team roster + Configure links |
| `/dashboard/ai-team/chat` | Team Room chat (concurrent agents, per-workspace rooms) |
| `/dashboard/generate` | Content generator (title OR keywords/topics; research-first; blogs with inline images; captions; scoring display) |
| `/dashboard/generate-images` | Image generator (**Image / Ad Creative** modes, platform presets, prompt enhancement) |
| `/dashboard/generate-videos` | Video generator (text-to-video / image-to-video selector → correct model; library with poster frames, resolution/codec chips, lightbox) |
| `/dashboard/analytics` | Per-workspace analytics + **SEO stats tab** (audits, content scores, published posts) |
| `/dashboard/seo` | SEO dashboard: audits, campaigns |
| `/dashboard/seo/campaigns` | Audit → tier → proposal → start-campaign flow (location, competitors, social research) |
| `/dashboard/seo/outreach` | Guest-post discovery + send + replies + "Discover from campaign plan" |
| `/dashboard/seo/opportunities` | Reddit/LinkedIn/Quora opportunity recommendations |
| `/dashboard/calendar` | Content calendar (proposed dashed entries, owner chips, approvals, edit/revise) |
| `/dashboard/workspaces` | Workspace management |
| `/dashboard/cms` | Website builder (blocks, sections/columns with backgrounds, boxed/full width, AI "build this block", forms/galleries/embeds) |
| `/dashboard/posts` | All posts with filter/search + CMS publish badge |
| `/dashboard/settings` | Account settings + security (2FA) |
| `/dashboard/settings/ai` | AI settings: connect provider keys, pick models per task |
| `/dashboard/settings/social` | Social account connections |
| `/dashboard/settings/blog` / `gbp` / `site` / `white-label` | Blog, Google Business Profile, site, white-label config |
| `/dashboard/billing` | Plans, upgrade, coupon entry |
| `/dashboard/admin` | Super-admin: users/licenses (delete fully), tenant management |
| `/dashboard/admin/coupons` | Issue coupon codes |
| `/dashboard/admin/apis` | APIs & Model Registry (connection state per provider, balances, model deprecation) |
| `/dashboard/admin/deploy` | VPS deploy with SSH test + path/process auto-detect |

**Public pages:** `/` (landing), `/about`, `/contact`, `/terms`, `/privacy`,
`/help`, `/login`, `/register`, `/forgot-password`, `/reset-password`,
`/seo/proposal` (client proposal + DocuSign), `/site/[slug]` (published CMS pages),
`/pending-approval`.

---

## 8. API surface (`src/app/api`)

| Area | Routes |
|---|---|
| Auth | `register`, `auth/resend-confirmation`, `auth/2fa/*` |
| Admin | `admin/apis`, `admin/models`, `admin/coupons`, `admin/deploy`, `admin/deploy/test`, `admin/migrations`(pending) |
| AI | `ai/models` (tenant-scoped picker), `ai-team/*`, `generate-content`, `generate-image`, `generate-video` |
| Media | `media/*`, `media/videos/[id]` (PATCH metadata), `media-assets` |
| Content | `posts`, `publish` (WordPress/CMS/API connectors), `pending-approval` |
| SEO | `seo/audit`, `seo/generate-campaign`, `seo/proposals`, `seo/campaigns` |
| Outreach | `outreach/discover`, `outreach/discover-from-campaign`, `outreach/[id]/send`, `outreach/reply-webhook` (public), `outreach/mark-seen` |
| Campaigns | `campaign-plans`, `campaign-refine` |
| Calendar | `calendar` (drag/reschedule, approval states) |
| Billing | `billing` (checkout with coupon validation), `usage` |
| CMS | `cms` (pages/blocks) |
| Integrations | `docusign`, `wordpress`, `webhooks`, `inngest`, `inbox`, `leads`, `opportunities`, `voice`, `sequences`, `tasks`, `analytics/seo`, `me`, `clients` |

All are authenticated via the proxy allowlist except: auth pages, `/api/inngest`,
`/api/outreach/reply-webhook` (self-authenticated by `OUTREACH_WEBHOOK_SECRET`),
public SEO proposal routes, and site/CMS rendering.

---

## 9. AI orchestration (`src/lib/ai/orchestrator.ts`)

**`getModelForTask(tenantId, task, clientId?, preferredModelId?)`** resolution order:
1. Explicit model override (picker choice) — only if the tenant has an active key for its provider.
2. `task_model_mappings` → `ai_models` → `ai_providers`.
3. Fallback: first provider of the task's type with a tenant key (`tenant_api_keys`).
4. Platform env defaults (OpenAI/DeepSeek text, Google image, Runway/fal video, ElevenLabs voice).

**Provider coverage:** text (DeepSeek v4-pro/flash, OpenAI, Anthropic, Gemini…), image
(Google Imagen `gemini-2.5-flash-image`/Nano Banana, DALL-E, Stability, Midjourney,
Leonardo, Firefly, Ideogram), video (Wan 2.1/2.2 via DashScope **or** fal.ai, Runway,
HeyGen, Pika, Synthesia, Kaiber), voice (ElevenLabs…), embeddings.

**Generator grounding:** blog generation injects workspace brand profile + KB context
+ real linkable pages. **Standalone image and video generators now do the same**
(`src/lib/ai/workspace-context.ts`): brand prompt + KB context is appended to the user
prompt before calling the provider.

**Blog pipeline:** title/keywords → research → outline → body (1500–2000 words) →
featured image + ≤3 images spaced by paragraphs, alternating left/right text wrap →
internal links (resolved against real KB/CMS pages, "Related reading" auto-appended when
none) → external links from research only → on-page score + gate.

---

## 10. Scoring engines

- **On-page SEO** (`src/lib/seo-scorer.ts`): 100-point pass/fail accumulation —
  keyword in title/meta/slug/first 10%/body, density, content-length scaling, outbound
  dofollow link, internal link, image alts containing keyword, paragraph readability
  (≤120 words), subheadings. Displays on content (Recent Content / post detail).
- **AEO/GEO** (`src/lib/aeo-geo.ts`): AI Engine Optimization / Generative Engine
  Optimization score (answer-engine friendly structure, entity coverage, schema,
  "people also ask" coverage…). Applied to generated pieces and blog posts; used by the
  publish gate.
- **Publish gate**: auto-rewrite below the score threshold (configurable; ~80%).

---

## 11. Campaign workflow (0 → 100)

1. **Audit** (`/dashboard/seo`) — enter site + optional location; system researches the
   site, competitors, and **social presence per competitor** (044) → SEO campaign JSON.
2. **Proposal** — tier packages (1000/5000/…), public page `/seo/proposal` with
   DocuSign; **signed contract stored on the workspace**; contract includes 60-day
   cancellation + terms clauses.
3. **Start campaign** — from the audit/proposal; creates an isolated workspace.
4. **Malory maps the plan** — ask in Team Room → `campaign_plans` with owner chips
   (which employee owns each item) → dashed calendar entries.
5. **Approvals** — approve ideas → content generated → **second approval** before
   publish/schedule (tier gating; images/videos per platform; video "coming soon" on
   TikTok/Threads/IG can fall back to images).
6. **Publish/schedule** — calendar + WordPress/CMS connector + social publishing;
   internal links auto when publishing to a generated site.
7. **Index** — auto-indexing of new/edited posts (IndexNow-style ping) once the site
   is indexed-enabled.
8. **Outreach** — weekly opportunity scan (guest posts, Reddit/LinkedIn/Quora
   recommendations, relevance-gated), email from platform, reply webhook auto-status
   (discovered → pitched → replied → accepted/published/rejected), notifications.

---

## 12. Billing, usage, coupons

- **Plans:** foundation / growth / dominance (Stripe products; metadata can override
  built-in `PLAN_LIMITS`).
- **Free trial:** 14 days, **scaled to 1 piece per week per content type**
  (blog, image, video) — enforced by `checkTrialContentLimit`.
- **Monthly enforcement:** `checkUsageLimit` on every generation endpoint returns 429
  when the metric is exhausted; counters in `usage` table per billing cycle;
  `monthlyBillingReset` Inngest job rolls the cycle.
- **Warnings:** Profile & Usage page (per-metric meters ≥80% amber, 100% red) and the
  dashboard **usage banner**.
- **Coupons:** super-admin `coupon_codes` (percent off, plan-restricted, max uses,
  expiry) applied at Stripe checkout via `billing` route.
- **Super-admin license ops:** toggle trial↔paid without recreating a license, renew
  without payment, hard-delete users/tenants/licenses.

---

## 13. Background jobs (Inngest)

`src/lib/inngest/functions/` — served at `/api/inngest` (dev: local listener; prod:
cloud-synced with `INNGEST_SIGNING_KEY`):

| Function | What it does |
|---|---|
| `teamChatTask` | Runs AI-team agent work in the queue (concurrent employees) |
| `publishScheduledPosts` | Publishes due scheduled posts |
| `autoRewritePost` | Rewrites below-score posts (score gate) |
| `fetchAnalytics` | Pulls analytics/social stats |
| `monthlyBillingReset` | Rolls usage counters for the new cycle |
| `weeklyOpportunityScan` | Weekly outreach/opportunity discovery |
| `processSequences` | Automation sequences |
| `syncInboxes` / `syncSocialInbox` | Email + social inbox sync |

---

## 14. Deployment

**Production:** VPS (platform.blissmedialab.com) behind a reverse proxy, PM2 process,
Next standalone build.

- **Deploy:** `node deploy-full-sync.cjs` from `agency-os/` — builds, rsyncs to the VPS,
  restarts PM2. The in-app Deploy page can also do this and auto-detects path/process
  over SSH.
- **DB migrations:** run manually in the Supabase SQL Editor (idempotent). Always
  migrate **before** deploying code that reads new columns.
- **Media:** stored in Bunny.net storage zone (`agencyos`), served via
  `agencyos.b-cdn.net`; `scripts/migrate-images-to-bunny.ts` moves legacy uploads.
- **Secrets:** `.env.local` (never committed); `.env.example` documents keys. Env keys
  used: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  `SUPABASE_ANON_KEY`, `SUPABASE_JWT_SECRET`, `ENCRYPTION_KEY`, `STRIPE_*`,
  `RESEND_API_KEY`, `OUTREACH_WEBHOOK_SECRET`, `DEEPSEEK_API_KEY`, `OPENAI_API_KEY`,
  `GOOGLE_API_KEY`, `FAL_AI_API_KEY`, `RUNWAY_API_KEY`, `DASHSCOPE_API_KEY`,
  `ELEVENLABS_API_KEY`, `INNGEST_*`, `DOCUSIGN_*`, `BUNNY_*`.

**Super-admin flow to release code:** commit → run pending migrations in SQL Editor →
`node deploy-full-sync.cjs` → smoke tests (`/`, `/login`, `/site/*`, auth-gated API 401s).

---

## 15. Security posture

- RLS disabled tables are admin-only via service-role; `coupon_codes`, `user_2fa`,
  `license_audit_log` have `no_direct_access` policies.
- Rate limiting on public/expensive endpoints (register, generate-content,
  generate-image, generate-video).
- Email verification required; 2FA (TOTP) optional per user.
- Encrypted tenant API keys; masked display only.
- `PUBLIC_ROUTES` allowlist in the proxy — everything else requires a session.
- Tenant-scope audit script runs in CI/pre-commit.
- Hard-delete paths for users/tenants/licenses (not just revoke).
- Webhook endpoints self-authenticate (`OUTREACH_WEBHOOK_SECRET`).

---

## 16. Beta-readiness checklist (what's left)

**Done and deployed:** all features above are live on the VPS at
`platform.blissmedialab.com` (as of the last deploy).

**Before inviting beta testers:**
1. Run migrations **042–044** (coupons, 2FA, social research) in the SQL Editor, then
   deploy the current batch (usage limits, tenant-scoped model registry, KB-grounded
   image/video generation, profile page, usage banner, admin API fixes).
2. Wire **Resend inbound** for auto reply-watching (`/api/outreach/reply-webhook`) +
   per-tenant inbound reply addresses.
3. Walk the live outreach pipeline end-to-end with a real sent email + logged reply.
4. Verify Stripe: products, prices, plan metadata ↔ `PLAN_LIMITS`, trial→paid toggle,
   coupon checkout, renewal-without-payment.
5. Fill the **knowledge base** for the flagship tenant and confirm generated images
   reflect the brand (the new KB grounding).
6. Set low-balance thresholds for every live provider key (APIs & Model Registry) and
   confirm the notification fires.
7. Draft the sales site / case-study pages + slideshow (or video) for the landing page.
8. QA pass on mobile menu, calendar approvals, publish modal, and the AI-team chat
   (concurrent agents, hand-offs).
9. Decide go/no-go on: ads generator rollout, guest-post auto-emailing at scale,
   video generation defaults for TikTok/IG/Threads.

---

*This document is a living reference — update it whenever a new migration, page, API,
or workflow is added.*
