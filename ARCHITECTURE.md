# Architecture

## Stack

- **Framework:** Next.js 16 (App Router, React 19, Turbopack dev)
- **Database/Auth:** Supabase (PostgreSQL + Auth + Storage)
- **Background Jobs:** Inngest
- **Payments:** Stripe
- **UI:** Tailwind CSS 4, Radix UI primitives, Recharts, Lucide icons
- **AI:** OpenAI, DeepSeek, fal.ai (images/video), ElevenLabs (voice)
- **Testing:** Vitest + jsdom

## Multi-Tenant Isolation

Every table carries a `tenant_id` column. The app layer enforces isolation via explicit `.eq("tenant_id", tenantId)` on every query — never rely on RLS alone.

**Cookie-based auth context** (set by `src/proxy.ts` middleware, HMAC-signed):

| Cookie | HttpOnly | Purpose |
|---|---|---|
| `x-tenant-id` | No (client reads for realtime channels) | Active tenant |
| `x-user-role` | Yes | Role level |
| `x-user-id` | Yes | Supabase auth user ID |
| `x-user-email` | Yes | Login email |
| `x-client-id` | Yes | Client portal target (client role only) |
| `workspace_id` | No | Selected workspace within tenant |

## Role Hierarchy

```
super_admin (4) > agency_admin (3) > agency_editor (2) > client (1)
```

Checked via `requireRole(minimumRole)` in `src/lib/auth.ts`. Super admins bypass token gates.

## Server-Side Data Access

1. **`getTenantId()`** — reads `x-tenant-id` cookie via HMAC verification.
2. **`createServiceClient()`** — bounded Supabase client with 10s fetch timeout.
3. **`getSupabaseWithTenant()`** — returns `{ client, tenantId }` for scoped queries.
4. **Global `undici` dispatcher** — server-boot transport timeouts (connect 10s / headers 30s / body 120s) so no external fetch can wedge the event loop.

## Middleware (`src/proxy.ts`)

Runs on every non-static request. Responsibilities:
- Verify Supabase session (with refresh on expiry)
- Resolve tenant + role from `user_roles` (multi-team: prefers cookie tenant)
- Set HMAC-signed auth cookies on every response
- CSP with per-request nonce
- Custom-domain → `/site/<slug>` rewrite
- Workspace cookie ownership check (prevents cross-tenant leak)

Auth context is cached in-memory (60s TTL, keyed by raw cookie).

## Background Jobs (Inngest)

Functions in `src/lib/inngest/functions/` run on schedules or event triggers:
- `fetchAnalytics` / `syncInboxes` / `processSequences` — recurring per-account
- `publishScheduledPosts` / `autoRewritePost` / `weeklyOpportunityScan`
- All use bounded Supabase clients and `fetchWithTimeout`.

## UI Patterns

- Dashboard layout: `src/app/dashboard/layout.tsx` with collapsible sidebar + `NavDropdown`
- Server Components default; `"use client"` only when interactivity needed
- Dark/light theme via `localStorage` + `prefers-color-scheme` (no flash on load)
- Forms: `react-hook-form` + Zod resolvers
- State: server actions preferred; client state only for UI toggles
- Mobile: responsive grid, drawer nav (PWA-capable with service worker)

## Key Directories

```
src/app/              — Next.js routes (dashboard, api, blog, portal, p/[slug])
src/components/       — Shared React components
src/lib/              — Core logic (auth, ai, seo, billing, connections, etc.)
src/lib/ai/           — Orchestrator, team tasks, model registry
src/lib/inngest/      — Background job definitions
src/lib/inbox/        — Email providers (Archer, Echo)
src/lib/seo/          — Analyzer, rewriter, campaigns, competitors
supabase/migrations/  — Numbered SQL migrations (001–094+)
scripts/              — Deploy, watchdog, backfill, probe utilities
```

## API Reference

All routes live under `src/app/api/`. **Auth** = requires valid session cookie (middleware-verified). **Public** = no session required. **Super admin** = `super_admin` role only.

### Auth & Session
| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/auth/session` | GET | Public | Current session info |
| `/api/auth/set-session` | POST | Public | Write session cookie after OAuth |
| `/api/auth/dev-login` | POST | Dev only | Passwordless dev sign-in |
| `/api/auth/resend-confirmation` | POST | Public | Resend email confirmation |
| `/api/auth/2fa/setup` | POST | Auth | Generate 2FA secret |
| `/api/auth/2fa/verify` | POST | Auth | Verify 2FA code |
| `/api/auth/2fa/status` | GET | Auth | Check 2FA enabled |
| `/api/auth/2fa/disable` | POST | Auth | Disable 2FA |
| `/api/auth/callback/google` | GET | Public | Google OAuth callback |
| `/api/auth/callback/twitter` | GET | Public | Twitter OAuth callback |
| `/api/auth/callback/meta` | GET | Public | Facebook/Instagram OAuth callback |
| `/api/auth/callback/outlook` | GET | Public | Microsoft OAuth callback |
| `/api/auth/gmail` | GET | Public | Gmail OAuth redirect |
| `/api/auth/outlook` | GET | Public | Outlook OAuth redirect |
| `/api/register` | POST | Public | User registration |

### AI Team & Chat
| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/ai-team/chat` | POST | Auth | Send message to AI employee |
| `/api/ai/models` | GET | Auth | List available AI models |

### Content Generation
| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/generate-content` | POST | Auth | Generate blog/article content |
| `/api/generate-content/upload` | POST | Auth | Upload content reference file |
| `/api/generate-image` | POST | Auth | Generate image via fal.ai |
| `/api/generate-image/enhance-prompt` | POST | Auth | Enhance image prompt with AI |
| `/api/generate-image/recent` | GET | Auth | Recent generated images |
| `/api/generate-video/enhance-prompt` | POST | Auth | Enhance video prompt |
| `/api/tasks/blog-generation` | POST | Auth | AI task: blog generation |

### Posts
| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/posts` | GET | Auth | List posts |
| `/api/posts/[id]` | GET | Auth | Get post detail |
| `/api/posts/[id]` | PATCH | Auth | Update post |
| `/api/posts/[id]` | DELETE | Auth | Delete post |
| `/api/posts/[id]/regenerate` | POST | Auth | Regenerate post content |
| `/api/posts/[id]/attempts` | GET | Auth | Generation attempt history |
| `/api/posts/[id]/aeo-geo` | POST | Auth | Run AEO/GEO audit on post |

### SEO
| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/seo/analyze` | POST | Auth | Full SEO/AEO/GEO analysis |
| `/api/seo/audits` | GET | Auth | List SEO audits |
| `/api/seo/audits` | POST | Auth | Create new audit |
| `/api/seo/rankings` | GET | Auth | Search Console keyword rankings |
| `/api/seo/rewrite` | POST | Auth | Rewrite content for SEO scores |
| `/api/seo/campaigns` | GET | Auth | List SEO campaigns |
| `/api/seo/campaigns/[id]` | PATCH | Auth | Update campaign |
| `/api/seo/campaigns/[id]` | DELETE | Auth | Delete campaign |
| `/api/seo/campaigns/[id]` | POST | Auth | Deploy campaign |
| `/api/seo/campaigns/[id]/approve` | POST | Auth | Approve campaign |
| `/api/seo/campaigns/[id]/re-run-audit` | POST | Auth | Re-run campaign audit |
| `/api/seo/campaigns/[id]/share` | PATCH | Auth | Toggle share link |
| `/api/seo/campaigns/[id]/sign-request` | GET | Auth | Generate docusign URL |
| `/api/seo/campaigns/[id]/sign-request` | POST | Auth | Send sign request |
| `/api/seo/campaigns/[id]/docusign` | GET | Auth | Docusign envelope status |
| `/api/seo/campaigns/[id]/docusign` | POST | Auth | Create docusign envelope |
| `/api/seo/generate-campaign` | POST | Auth | AI-generate campaign plan |
| `/api/seo/client-proposals` | GET | Auth | List client proposals |
| `/api/seo/public-proposal` | GET | Public | View public proposal |
| `/api/seo/public-proposal/[id]/sign` | GET | Public | Docusign signing page |
| `/api/seo/public-proposal/[id]/sign` | POST | Public | Submit signature |
| `/api/seo/public-audit/[id]` | GET | Public | View shared audit |

### Outreach
| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/outreach` | GET | Auth | List outreach contacts |
| `/api/outreach` | POST | Auth | Create outreach contact |
| `/api/outreach/[id]` | PATCH | Auth | Update contact |
| `/api/outreach/[id]` | DELETE | Auth | Delete contact |
| `/api/outreach/[id]/send` | POST | Auth | Send outreach email |
| `/api/outreach/[id]/pitch` | POST | Auth | AI-generate pitch |
| `/api/outreach/discover` | POST | Auth | Discover prospects |
| `/api/outreach/discover-from-campaign` | POST | Auth | Discover from campaign |
| `/api/outreach/mark-seen` | POST | Auth | Mark contacts seen |
| `/api/outreach/reply-webhook` | POST | Public | Inbound email webhook |

### Media & Assets
| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/media/images` | GET | Auth | List images |
| `/api/media/images` | POST | Auth | Upload image |
| `/api/media/videos` | GET | Auth | List videos |
| `/api/media/videos` | POST | Auth | Generate video |
| `/api/media/videos/[id]` | PATCH | Auth | Update video |
| `/api/media/videos/[id]/thumbnail` | POST | Auth | Generate thumbnail |
| `/api/media/voice` | GET | Auth | List voice clips |
| `/api/media/voice` | POST | Auth | Generate voice clip |
| `/api/media/assets/[id]` | GET | Auth | Get asset detail |
| `/api/media/assets/[id]` | DELETE | Auth | Delete asset |
| `/api/media-assets/[id]` | PATCH | Auth | Update media asset |
| `/api/media-assets/[id]` | DELETE | Auth | Delete media asset |
| `/api/media-assets/[id]/duplicate` | POST | Auth | Duplicate asset |
| `/api/media-assets/[id]/drive` | POST | Auth | Sync asset to Google Drive |
| `/api/assets` | GET | Auth | List asset library |
| `/api/assets/folders` | GET | Auth | List asset folders |
| `/api/assets/folders` | POST | Auth | Create folder |
| `/api/assets/folders/[id]` | PATCH | Auth | Rename folder |
| `/api/assets/folders/[id]` | DELETE | Auth | Delete folder |

### Clients & Workspaces
| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/clients` | GET | Auth | List clients |
| `/api/clients` | POST | Auth | Create client |
| `/api/tenant/admin-access` | GET | Auth | Check admin access |
| `/api/tenant/admin-access` | POST | Auth | Request admin access |

### Campaign Plans
| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/campaign-plans` | GET | Auth | List campaign plans |
| `/api/campaign-plans` | POST | Auth | Create campaign plan |
| `/api/campaign-plans/refine` | POST | Auth | AI-refine plan |
| `/api/campaign-plans/from-proposal` | POST | Auth | Create plan from proposal |

### Calendar
| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/calendar/events` | GET | Auth | List calendar events |
| `/api/calendar/events` | POST | Auth | Create calendar event |

### Sequences
| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/sequences` | GET | Auth | List sequences |
| `/api/sequences` | POST | Auth | Create sequence |
| `/api/sequences/[id]` | PATCH | Auth | Update sequence |
| `/api/sequences/[id]` | DELETE | Auth | Delete sequence |
| `/api/sequences/[id]/enroll` | POST | Auth | Enroll contact |

### Leads
| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/leads` | GET | Auth | List leads |
| `/api/leads` | POST | Auth | Create lead |
| `/api/leads/[id]` | GET | Auth | Get lead detail |
| `/api/leads/[id]` | PATCH | Auth | Update lead |
| `/api/leads/[id]` | DELETE | Auth | Delete lead |
| `/api/leads/[id]/enrich` | POST | Auth | AI-enrich lead |
| `/api/leads/[id]/email` | POST | Auth | Send email to lead |
| `/api/leads/[id]/sms` | POST | Auth | Send SMS to lead |
| `/api/leads/import/apollo` | POST | Auth | Import from Apollo |

### Opportunities
| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/opportunities` | GET | Auth | List opportunities |
| `/api/opportunities` | PATCH | Auth | Update opportunity |
| `/api/opportunities` | DELETE | Auth | Delete opportunity |
| `/api/opportunities/generate` | POST | Auth | AI-generate opportunities |

### Inbox
| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/inbox/emails` | GET | Auth | List email threads |
| `/api/inbox/emails` | POST | Auth | Sync emails |
| `/api/inbox/social` | GET | Auth | List social messages |
| `/api/inbox/social` | POST | Auth | Sync social messages |
| `/api/inbox/social/[id]/reply` | POST | Auth | Reply to social message |

### Analytics
| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/analytics` | GET | Auth | Analytics overview |
| `/api/analytics/seo` | GET | Auth | SEO analytics |
| `/api/analytics/sync` | POST | Auth | Trigger analytics sync |

### CMS / Page Builder
| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/cms/pages` | GET | Auth | List CMS pages |
| `/api/cms/pages` | POST | Auth | Create CMS page |
| `/api/cms/pages/[id]` | GET | Auth | Get page detail |
| `/api/cms/pages/[id]` | PATCH | Auth | Update page |
| `/api/cms/pages/[id]` | DELETE | Auth | Delete page |
| `/api/cms/settings` | GET | Auth | CMS settings |
| `/api/cms/settings` | PUT | Auth | Update CMS settings |
| `/api/cms/domains` | GET | Auth | List custom domains |
| `/api/cms/domains` | POST | Auth | Add custom domain |
| `/api/cms/domains` | DELETE | Auth | Remove domain |
| `/api/cms/forms` | POST | Public | Submit contact form |
| `/api/cms/submissions` | GET | Auth | List form submissions |
| `/api/cms/upload` | POST | Auth | Upload CMS media |
| `/api/cms/ai-block` | POST | Auth | AI-generate page block |

### Notifications
| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/notifications` | GET | Auth | List notifications |
| `/api/notifications` | POST | Auth | Create notification |
| `/api/notifications` | DELETE | Auth | Delete notification |
| `/api/notifications/read-link` | POST | Auth | Mark notification read |
| `/api/push/vapid-key` | GET | Public | VAPID public key |
| `/api/push/subscribe` | POST | Auth | Subscribe to push |
| `/api/push/subscribe` | DELETE | Auth | Unsubscribe from push |
| `/api/push/pending` | GET | Auth | Pending push notifications |

### Billing & Subscriptions
| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/billing` | GET | Auth | Billing info |
| `/api/billing` | POST | Auth | Create/update subscription |
| `/api/billing/topup` | POST | Auth | Purchase token add-on |
| `/api/usage` | GET | Auth | Token usage stats |

### Publishing
| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/publish` | POST | Auth | Publish to WordPress |
| `/api/wordpress/categories` | GET | Auth | List WordPress categories |

### Admin (Super Admin Only)
| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/admin/apis` | GET | Super admin | List API keys |
| `/api/admin/apis` | POST | Super admin | Save API key |
| `/api/admin/models` | GET | Super admin | List AI model configs |
| `/api/admin/models` | POST | Super admin | Update model config |
| `/api/admin/subscriptions` | GET | Super admin | List all subscriptions |
| `/api/admin/subscriptions` | POST | Super admin | Create subscription |
| `/api/admin/subscriptions` | PUT | Super admin | Update subscription |
| `/api/admin/subscriptions` | DELETE | Super admin | Delete subscription |
| `/api/admin/coupons` | GET | Super admin | List coupons |
| `/api/admin/coupons` | POST | Super admin | Create coupon |
| `/api/admin/deploy` | GET | Super admin | Deploy status |
| `/api/admin/deploy` | PUT | Super admin | Update deploy config |
| `/api/admin/deploy` | POST | Super admin | Trigger deploy |
| `/api/admin/deploy/test` | POST | Super admin | Test deploy connection |
| `/api/admin/login-as` | POST | Super admin | Impersonate user |
| `/api/admin/site-blog` | GET | Super admin | List blog posts |
| `/api/admin/site-blog` | POST | Super admin | Create blog post |
| `/api/admin/site-blog/[id]` | PATCH | Super admin | Update blog post |
| `/api/admin/site-blog/[id]` | DELETE | Super admin | Delete blog post |
| `/api/admin/page-builder` | GET | Super admin | Get page builder config |
| `/api/admin/page-builder` | PUT | Super admin | Save page builder config |
| `/api/admin/page-builder/chat` | POST | Super admin | AI page builder chat |
| `/api/admin/page-builder/pricing` | POST | Super admin | AI pricing page builder |
| `/api/admin/nav-config` | GET | Super admin | Get nav config |
| `/api/admin/nav-config` | PUT | Super admin | Save nav config |

### Webhooks (Public)
| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/webhooks/stripe` | POST | Public (verified) | Stripe event handler |
| `/api/telegram/webhook` | POST | Public (verified) | Telegram bot updates |
| `/api/discord/webhook` | POST | Public (verified) | Discord bot updates |

### Public Pages & Misc
| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/version` | GET | Public | Build version |
| `/api/me` | GET | Auth | Current user info |
| `/api/sign/[token]` | GET | Public | DocuSign signing page |
| `/api/sign/[token]` | POST | Public | Submit signature |
| `/api/data-deletion` | POST | Public | Request data deletion |
| `/api/export-data` | POST | Public | Request data export |
| `/api/docusign/connect` | POST | Public | DocuSign OAuth callback |
| `/api/inngest` | POST | Public (signed) | Inngest function endpoints |

---

## Database Schema

94 numbered migrations in `supabase/migrations/`. Every multi-tenant table has `tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE` plus a `tenant_isolation` RLS policy (defense-in-depth — app layer enforces via `.eq("tenant_id")`).

### Core Tables

```
tenants ──────────────────────────────────────────────────────────
  │ PK: id (uuid)
  │ name, slug (unique), logo_url, primary_color, custom_domain
  │
  ├── user_roles ─────────────────────────────────────────────────
  │     PK: (user_id, tenant_id) — FK → auth.users, tenants
  │     role: super_admin | agency_admin | agency_editor | client
  │     client_id → clients.id (nullable)
  │
  ├── workspaces ─────────────────────────────────────────────────
  │     PK: id, UNIQUE(tenant_id, slug)
  │     name, is_default, description, logo_url
  │     │
  │     ├── workspace_members ────────────────────────────────────
  │     │     PK: (workspace_id, user_id)
  │     │     role: admin | editor | viewer
  │     │
  │     ├── clients ──────────────────────────────────────────────
  │     │     PK: id, tenant_id, workspace_id
  │     │     name, website, notes
  │     │     │
  │     │     ├── client_onboarding (step tracking, JSONB progress)
  │     │     └── posts ──────────────────────────────────────────
  │     │           PK: id, tenant_id, workspace_id, client_id
  │     │           content, media_urls, scheduled_at, status
  │     │           │
  │     │           ├── post_platforms (per-platform publish state)
  │     │           ├── comments
  │     │           ├── publishing_logs
  │     │           └── analytics_snapshots (likes, shares, reach)
  │     │
  │     ├── knowledgebase_folders (tree via parent_folder_id)
  │     │     └── knowledgebase_items
  │     │           type: url | doc | image | video | text
  │     │           scraped_text, extracted_metadata (JSONB)
  │     │
  │     ├── brand_profiles (voice, tone, SEO rules, formatting)
  │     ├── asset_folders ─── media_assets
  │     │     type: image | video | voice
  │     │     prompt, url, status, metadata (JSONB)
  │     │
  │     ├── seo_campaigns ── site_audits, competitors
  │     ├── social_accounts
  │     ├── blog_platforms
  │     ├── google_business_profiles
  │     └── task_model_mappings (AI model per task per workspace)
  │
  ├── ai_providers ── ai_models ── tenant_api_keys (encrypted)
  ├── subscriptions ── subscription_registry (Stripe IDs)
  ├── tenant_connections (OAuth tokens for social/Google/Outlook)
  ├── tenant_settings, provider_balances
  ├── site_pages (CMS), site_domains, cms_site_settings
  ├── nav_config (per-tenant menu override)
  └── licenses, tier_templates, coupon_codes
```

### Token Billing Tables (service-layer only — RLS denies all direct access)

```
token_plans ──────── plan_id (Stripe price) → monthly allowance USD
token_addons ─────── purchasable denominations (≥ $20)
model_rates ──────── per-model pricing (input/output per 1M tokens, asset price)
token_ledger ─────── append-only usage/purchase/allowance/refund rows
tenant_balances ──── live monthly_allowance + addon_balance per tenant
```

### AI Team & Chat

```
ai_employees ──── tenant_ai_employees (enable/disable per tenant)
team_chats ────── team_messages
  kind: team | employee
  role: user | employee | system
  metadata: JSONB (tool calls, post IDs, handoffs)
```

### Other Notable Tables

- **leads, lead_activities, sequences, sequence_enrollments, call_logs** — outreach pipeline
- **outreach_targets, content_opportunities** — prospecting
- **email_accounts** — Archer/Echo provider tokens
- **calendar_events** — content calendar
- **sign_requests** — DocuSign envelope tracking
- **notifications, push_subscriptions, vapid_keys** — in-app + web push
- **telegram_links, telegram_user_prefs, discord_links** — messaging integrations
- **admin_audit_log** — delete/demote/role-change audit trail
- **site_blog_posts** — super-admin site blog with SEO/AEO score columns
- **campaign_plans, campaign_plan_items** — AI-generated campaign blueprints
- **keyword_rankings, traffic_snapshots** — Search Console data cache
- **indexnow_keys** — IndexNow API key registry

---

## Security

### HMAC Cookie Signing (`src/lib/auth-signature.ts`)

Every auth cookie value is signed with HMAC-SHA256 before being written to the browser:

```
signAuthValue(value) → "<value>.<base64url-hmac>"
verifyAuthValue(signed) → value | null
```

- **Secret:** `AUTH_COOKIE_SECRET` (or `ENCRYPTION_KEY`); dev fallback is a hardcoded non-production key.
- **Why:** The middleware derives auth context from the *verified* Supabase session, then writes signed cookies. Server-side readers verify the signature before trusting, so a client cannot forge `x-user-role=super_admin` or point `x-tenant-id` at another tenant.
- **Timing-safe:** `timingSafeEqual` prevents timing side-channels.
- **`x-tenant-id`** is readable by the client (for Supabase realtime channel naming) but still signed — the server verifies before trusting.

### Content Security Policy (`src/proxy.ts`)

Every response includes a strict CSP header built per-request:

- **Nonce:** 16 random bytes → `base64url`. Tagged inline scripts via `nonce-<value>`; Next.js auto-tags its own RSC scripts.
- **`script-src 'self' 'nonce-<value>'`** — no `unsafe-inline` in production.
- **`style-src 'self' 'unsafe-inline'`** — kept for React inline style attributes.
- **`connect-src`** — locked to self + Supabase + known AI providers.
- **`frame-src 'self'`** — no third-party iframes.
- The nonce is passed to server components via the `x-nonce` request header.

### RBAC Enforcement Points

1. **Middleware** (`proxy.ts`): reads `user_roles` for every request, sets `x-user-role` cookie. Redirects unauthenticated users to `/login`; users with no role to `/pending-approval`.
2. **`requireRole(minimumRole)`** (`src/lib/auth.ts`): throws if `ROLE_HIERARCHY[caller] < ROLE_HIERARCHY[required]`. Used in route handlers and server actions.
3. **Super admin checks**: `if (role !== "super_admin") return 403` in admin routes.
4. **Client portal**: `requireClientRole()` ensures only `client` role users access client-scoped data, returning their `client_id`.
5. **Token gates**: `super_admin` and `agency_admin` roles bypass token balance checks — only `client` and `agency_editor` are metered.

### Other Security Measures

- **All external fetches** bounded via `fetchWithTimeout` (15s default) or global `undici` dispatcher (connect 10s / headers 30s / body 120s).
- **Supabase service client** (`createServiceClient`) has 10s fetch timeout — prevents middleware wedge on egress blips.
- **Disposable-email blocklist** rejects signups from temp-mail domains.
- **Admin audit log** records every delete-user, delete-tenant, and role-change attempt with actor + target + timestamp.
- **Webhook signature verification** on Stripe, Telegram, Discord incoming hooks.
- **2FA** via TOTP (setup/verify/disable endpoints).

---

## Adding a New Feature (End-to-End Guide)

### 1. Database Migration

Create `supabase/migrations/NNN_description.sql` (next number in sequence):

```sql
CREATE TABLE IF NOT EXISTS my_feature (
    id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
    -- your columns
    created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_my_feature_tenant ON my_feature (tenant_id);
ALTER TABLE my_feature ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY "tenant_isolation" ON my_feature
        FOR ALL USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
```

Run in Supabase SQL editor or `supabase db push`.

### 2. API Route

Create `src/app/api/my-feature/route.ts`:

```typescript
import { NextResponse } from "next/server"
import { getTenantId, createServiceClient } from "@/lib/auth"

export async function GET() {
  const tenantId = await getTenantId()
  const db = createServiceClient()
  const { data, error } = await db
    .from("my_feature")
    .select("*")
    .eq("tenant_id", tenantId)        // always scope by tenant
    .order("created_at", { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
```

Add to `PUBLIC_ROUTES` in `proxy.ts` only if it must be unauthenticated.

### 3. UI Page

Create `src/app/dashboard/my-feature/page.tsx`:

- Use Server Component by default (no `"use client"` unless you need interactivity).
- Import shared components from `src/components/ui/` (Button, Card, etc.).
- Fetch data via server actions or directly in the component.
- Follow the existing `NavDropdown` pattern — add the link to `src/lib/nav-sections.ts` under the appropriate hub.

### 4. Tests

Create `src/lib/my-feature.test.ts` (Vitest):

```typescript
import { describe, it, expect } from "vitest"
describe("myFeature", () => {
  it("does the thing", () => {
    expect(myFunction(input)).toEqual(expected)
  })
})
```

Run: `npm test`. Aim for logic/business-rule coverage; skip pure UI rendering tests unless critical.

### 5. Commit & Deploy

```bash
git add -A
git commit -m "feat: add my-feature"
npm test          # verify all 399+ tests pass
npm run build     # verify production build
```

Deploy via `node scripts/deploy.cjs` or push to trigger CI.

### Checklist

- [ ] Migration has `tenant_id` + RLS policy
- [ ] All queries include `.eq("tenant_id", tenantId)`
- [ ] External fetches use `fetchWithTimeout` or bounded client
- [ ] Route handler reads auth via `getTenantId()` / `requireRole()`
- [ ] Nav link added to `nav-sections.ts`
- [ ] Tests pass (`npm test`)
- [ ] Build succeeds (`npm run build`)

---

## Deployment

- **VPS:** systemd unit `agencyos` runs `next start` on `127.0.0.1:3000`
- **Reverse proxy:** nginx proxies from public :443 → localhost :3000 (WebSocket support)
- **Deploy:** `scripts/deploy.cjs` uploads code, runs `npm run build` remotely, signals systemd restart
- **Watchdog:** `scripts/watchdog-v2.sh` runs every minute via cron, restarts on double-failure
