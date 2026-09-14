# Agency OS

**Multi‑tenant SaaS platform for digital agencies.**  
AI content generation · white‑labelled client portals · tiered SEO campaign proposals · social media scheduling · billing (Stripe) · analytics dashboard.

[![CI](https://img.shields.io/github/actions/workflow/status/webspinnerandroid-ops/agencyos/ci.yml?label=CI&style=flat-square)](.github/workflows/ci.yml)  
[![Price drift check (nightly)](https://img.shields.io/github/actions/workflow/status/webspinnerandroid-ops/agencyos/price-drift.yml?label=price%20drift%20(nightly)&style=flat-square)](.github/workflows/price-drift.yml)

---

## Table of Contents

1. [Tech Stack](#tech-stack)
2. [Prerequisites](#prerequisites)
3. [Local Setup](#local-setup)
4. [Environment Variables](#environment-variables)
5. [Database Migrations](#database-migrations)
6. [Seed Data](#seed-data)
7. [Development](#development)
8. [Project Structure](#project-structure)
9. [Testing](#testing)
10. [Deployment (Vercel)](#deployment-vercel)
11. [CI (GitHub Actions)](#ci-github-actions)
12. [Troubleshooting](#troubleshooting)
13. [License](#license)

---

## Tech Stack

| Layer              | Technology                                                          |
| ------------------ | ------------------------------------------------------------------- |
| Framework          | [Next.js 16](https://nextjs.org/) (App Router)                      |
| Language           | TypeScript 5                                                        |
| Styling            | Tailwind CSS 4 + shadcn/ui components                              |
| Database           | [Supabase](https://supabase.com/) (PostgreSQL)                      |
| Auth               | Supabase Auth (email/password, session cookies)                     |
| Background Jobs    | [Inngest](https://www.inngest.com/) (blog generation, SEO crawling) |
| Payments           | [Stripe](https://stripe.com/) (subscriptions & invoices)            |
| AI / LLM           | Multi‑provider (OpenAI, Anthropic, Gemini, etc.) — user‑managed keys |
| Email              | Supabase built‑in (or connect Resend / SendGrid via webhooks)       |
| Deployment         | Vercel (Next.js native)                                             |
| CI                 | GitHub Actions (lint → type‑check → build)                          |

---

## Prerequisites

- **Node.js** ≥ 20
- **npm** ≥ 10
- **Supabase account** (local or hosted)  
  → [supabase.com](https://supabase.com/) or `npx supabase init` for local dev.
- **Stripe account** (for billing; optional in local dev — billing routes return mock data when keys are missing)
- **AI provider API key** (OpenAI / Anthropic / Google Gemini) — at least one for content generation

---

## Local Setup

```bash
# 1. Clone the repository
git clone https://github.com/your-org/agency-os.git
cd agency-os

# 2. Install dependencies
npm install

# 3. Copy and fill the environment file
cp .env.example .env.local
# Fill .env.local with your Supabase, Stripe, and AI keys (see below)

# 4. Run database migrations (see Database Migrations section)
#    If using Supabase CLI:
npx supabase link --project-ref <your-project-ref>
npx supabase db push

# 5. (Optional) Seed AI providers/models for task‑model mapping
npx tsx scripts/seed-analytics.ts   # seeds dashboards/models table

# 6. Start the development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Environment Variables

| Variable                                | Required | Description                                                 |
| --------------------------------------- | :------: | ----------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`              | ✅       | Supabase project URL (e.g. `https://xxx.supabase.co`)        |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`         | ✅       | Supabase anonymous / public key                             |
| `SUPABASE_SERVICE_ROLE_KEY`             | ✅       | Supabase **service_role** key (bypasses RLS; keep secret)   |
| `NEXT_PUBLIC_SITE_URL`                  |          | Canonical URL (default: `http://localhost:3000`)             |
| `STRIPE_SECRET_KEY`                     |          | Stripe secret key (`sk_live_…` or `sk_test_…`)              |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`    |          | Stripe publishable key (`pk_live_…` or `pk_test_…`)         |
| `STRIPE_WEBHOOK_SECRET`                 |          | Stripe webhook signing secret                               |
| `OPENAI_API_KEY`                        |          | (Or provider‑specific key set via **AI Settings** dashboard) |
| `INNGEST_EVENT_KEY`                     |          | Inngest event key (for background job processing)            |
| `INNGEST_SIGNING_KEY`                   |          | Inngest signing key                                        |

**Note:** AI provider keys are **stored per‑tenant** inside the database (encrypted at rest). You can also set a system‑wide fallback with `OPENAI_API_KEY` (or equivalent) in your environment — but the recommended approach is to add keys through the **AI Settings** dashboard page (`/dashboard/settings/ai`) so each agency can bring their own keys.

---

## Database Migrations

All migrations live in the `supabase/migrations/` folder.

- **Managed Supabase:** Push migrations via the Supabase CLI:
  ```bash
  npx supabase db push
  ```
- **Local Supabase:** Start the local Supabase stack and apply migrations:
  ```bash
  npx supabase start
  npx supabase db push
  ```

**Key tables:**
- `tenants` — agencies (multi‑tenant isolation)
- `clients` — end‑clients of an agency
- `posts` — social media posts (draft, scheduled, published)
- `post_analytics` — metrics snapshots per post
- `seo_campaigns` — tiered SEO proposals
- `subscription_plans` / `subscriptions` — Stripe‑linked billing
- `ai_providers` / `ai_models` / `tenant_api_keys` — encrypted LLM key store
- `usage_logs` — metered usage (AI tokens, social profiles)
- `content_map_imports` / `content_map_items` — bulk content planning (CSV of a year's ideas per client, migration 101)

### ⚠️ Pending on next deploy

- **`100_aeo_geo_split_scores.sql`** — adds `posts.aeo_geo_split` JSONB (`{ aeo, geo }`) and extends the
  `sync_post_seo_columns()` trigger to populate it from `content->'aeoGeo'` on insert/update, then backfills
  existing rows. **Run it before or with the release** that ships the analytics pillar split — until it runs,
  the analytics dashboard's "Avg AEO/GEO" card shows only the combined score and no AEO/GEO sub-averages
  (older rows are covered by the backfill; posts generated after it are filled automatically by the trigger).
- **`108_publish_retry_backoff.sql`** — adds `posts.publish_retry_count` + `posts.publish_retry_at` and a
  partial index on due failed posts. Powers the self-healing publish retries; until it runs the retry sweeper
  logs "column does not exist" and no retries happen (the app keeps working otherwise).
- **New Inngest crons** (registered on `/api/inngest`, no new env vars):
  - `process-auto-publish-holds` — every minute; resolves the 15-minute auto-publish undo window on
    serverless deploys (scheduled content-map rows → WordPress `future` / social queue).
  - `process-publish-retries` — every minute; retries failed publishes on a 5 min → 30 min → 2 h backoff
    ladder, then escalates (alert notification + surfaced in the Scheduled panel).
  - `publishing-health-weekly-email` — Mondays 08:30 UTC; per-client scheduled/published/failed summary
    for the last 7 days (Resend; logs instead of failing when `RESEND_API_KEY` is unset).
  - `refresh-model-catalog` — **twice daily** (03:00 & 15:00 UTC); pulls each configured AI provider's
    live model list and upserts `ai_models`, so new models appear in pickers and retired ones are
    flagged deprecated with no code change. Uses the platform env key per provider (or a tenant-stored
    key); OpenRouter's public catalog syncs keyless. Providers without a key are skipped and reported.
    Manual counterpart: **Admin → APIs & Models → Models → “Sync model catalogs”**; the panel shows
    the last sync time per model.
- **Migration 110** (`110_ai_models_catalog_sync`) — deduplicates `ai_models` on
  `(provider_id, model_identifier)`, adds the UNIQUE constraint the catalog upsert requires, and
  `last_verified_at` for freshness stamps. Until it runs, the cron logs upsert errors and the model
  list simply stays as seeded (the app keeps working otherwise).
- **Scheduled panel** (`/dashboard/scheduled`, nav under Manage) — overview of everything queued for the
  publish cron (upcoming / due / overdue >1 h) plus persistent failures whose retry ladder is exhausted.
  Persistent failures have **Retry now** (re-queue a fresh attempt immediately) and **Dismiss**
  (record a reason; the failure stays in history but leaves the panel) actions.

### Runbook: diagnosing publish failures

**Where the logs live**

- `publishing_logs` table — one row per platform attempt per post: `platform`, `success`,
  `error_message`, `attempt_at`. The post detail modal, the Content Map's publishing-history panel,
  and the Posts list all render these rows; query directly for deeper digs:
  `select * from publishing_logs where post_id = '…' order by attempt_at desc;`
- `posts.status` — the post-level rollup (see statuses below).
- Server logs — the retry sweeper logs `[publish-retries] …`, the hold processor `[auto-publish] …`,
  and the publish cron `[publishScheduledPosts] …`.

**What each post status means**

| Status | Meaning |
| --- | --- |
| `draft` | Generated, not approved. If `auto_publish_at` is set, the 15-minute undo window is running. |
| `scheduled` | Approved and queued — the publish cron publishes it when `scheduled_at` arrives (blogs also go to WordPress with WP status `future` for that date). |
| `published` | Delivered to the connected platform(s). Check `publishing_logs` for the live URL(s). |
| `failed` | The last delivery attempt threw. **Not terminal** — the retry ladder (below) takes over automatically. |

**The retry ladder (self-healing)**

A failed publish is retried automatically on a backoff ladder — **5 min → 30 min → 2 h** (3 attempts,
~2.5 h total). Retries go through the same channel the post failed on (blogs → WordPress publisher,
socials → their assigned accounts) and ring the bell with "Failed publish recovered" when one lands.

- **Escalation:** after the third failed retry the post is marked as needing a human: an **alert**
  notification fires ("Publishing keeps failing"), and the post appears under **"Failed — automatic
  retries exhausted"** in the Scheduled panel with its last error.
- **Resolve it there:** **Retry now** re-queues a fresh attempt immediately (clears the ladder);
  **Dismiss** records a reason (the post stays `failed` in history but leaves the active list).
- Dismissed/escalated state is tracked on the post itself (`publish_dismissed_at`,
  `publish_dismiss_reason`, `publish_failed_at`), so the panel and the weekly publishing-health
  email ("Needs a human" / "Recovered" columns) stay consistent.

---

## Seed Data

Two scripts are provided:

```bash
# Seed AI provider + model catalog (OpenAI, Anthropic, Gemini)
npx tsx scripts/seed-analytics.ts

# Test AI prompt templates independently
npx tsx scripts/test-ai-prompts.ts
```

---

## Development

```bash
npm run dev      # Start Next.js dev server on :3000
npm run lint     # Run ESLint
npm run build    # Production build (used by CI too)
```

### Inngest Dev Server

To test background functions (blog generation, SEO crawling) locally:

```bash
npx inngest-cli dev
```

Then open [http://localhost:8288](http://localhost:8288) for the Inngest dashboard.

### Stripe Webhooks

For local end‑to‑end billing testing:

1. Install the [Stripe CLI](https://stripe.com/docs/stripe-cli).
2. Forward events to your local dev server:
   ```bash
   stripe listen --forward-to localhost:3000/api/webhooks/stripe
   ```
3. Set `STRIPE_WEBHOOK_SECRET` in `.env.local` to the signing secret the CLI prints.

---

## Project Structure

```
agency-os/
├── public/                     # Static assets
├── scripts/                    # Seed & utility scripts
│   ├── seed-analytics.ts
│   └── test-ai-prompts.ts
├── supabase/
│   └── migrations/             # SQL migrations
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── (client-portal)/   # White‑labelled client portal
│   │   ├── dashboard/          # Agency dashboard shell & pages
│   │   ├── api/                # Route Handlers (REST API)
│   │   ├── error.tsx           # Root error boundary ⬅ NEW
│   │   ├── global-error.tsx    # Global error boundary ⬅ NEW
│   │   ├── loading.tsx         # Root loading fallback ⬅ NEW
│   │   └── layout.tsx          # Root layout (metadata template)
│   ├── components/             # Reusable UI
│   │   ├── ui/                 # shadcn/ui primitives + skeleton ⬅ UPDATED
│   │   ├── ThemeProvider.tsx
│   │   ├── ContentCalendar.tsx
│   │   └── AnalyticsPDF.tsx
│   ├── lib/                    # Business logic
│   │   ├── ai/                 # Orchestrator, SEO prompts
│   │   ├── inngest/            # Inngest client & functions
│   │   ├── publishing/         # Social media publisher
│   │   ├── seo/                # Auditor, competitors, deployer
│   │   ├── supabase/           # Browser & server clients
│   │   ├── auth.ts
│   │   ├── encryption.ts
│   │   ├── notifications.ts
│   │   ├── tenant.ts
│   │   ├── usage.ts
│   │   ├── utils.ts            # cn() helper
│   │   └── validations.ts
│   └── middleware.ts           # Auth guard, tenant mapping
├── .github/
│   └── workflows/
│       └── ci.yml             # GitHub Actions CI pipeline ⬅ NEW
├── .env.example
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

---

## Testing

Currently, manual end‑to‑end verification is used (see `docs/TEST_PLAN.md`). A placeholder for an automated test suite exists in `.github/workflows/ci.yml`.

To add automated tests:

```bash
npm install --save-dev vitest @vitejs/plugin-react jsdom
# Then create __tests__/ folders adjacent to source files.
```

---

## Deployment (Vercel)

### One‑click setup

1. Push your repository to GitHub.
2. Go to [vercel.com/new](https://vercel.com/new) and import the repo.
3. Vercel automatically detects it's a Next.js project.
4. **Add environment variables** in the Vercel dashboard:  
   **Settings → Environment Variables**  
   Copy all variables from `.env.example` (see [Environment Variables](#environment-variables) section).  
   ⚠️ Mark `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, and `STRIPE_WEBHOOK_SECRET` as **Secret**.
5. **Set the build command** (default works): `npm run build`
6. **Set the output directory** (default works): `.next`
7. Deploy! Every push to `main` will trigger a new production deployment.  
   Pull‑request previews are generated automatically.

### Custom domain

- Add your domain in **Vercel → Settings → Domains**.
- Then set it in the **White‑Label** dashboard page (`/dashboard/settings/white-label`) so the platform maps it to your tenant.

---

## CI (GitHub Actions)

On every push to `main` / `develop` and every PR to `main`, the pipeline:

1. **Lint** — `npm run lint`
2. **Type‑check** — `npx tsc --noEmit`
3. **Build** — `npm run build` (catches bundler errors)

The workflow definition lives at `.github/workflows/ci.yml`.

> **Secrets needed in GitHub:**  
> Go to **Repo → Settings → Secrets and variables → Actions** and add placeholders (or real values) for the build step. At minimum the build step needs dummy env vars — the default YAML provides fallbacks for CI.

### Nightly Price‑Drift Guard

A scheduled job (`.github/workflows/price-drift.yml`, 03:17 UTC daily, also manually runnable) compares every plan and hub's stored landing‑page price against its **live Stripe** monthly price — the same resolution logic the page builder uses (`src/lib/stripe-pricing.ts`). The job fails when anything drifts, and the shield badge above reflects the latest nightly result.

- **Notify on every nightly result** — add repo **secrets** (Settings → Secrets and variables → Actions):
  - **`PRICE_DRIFT_WEBHOOK_URL`** — a Slack or Discord incoming webhook URL, or an **ntfy.sh topic** (`https://ntfy.sh/<your-topic>`) that pushes straight to your phone with no account or server setup (install the ntfy app and subscribe to the topic to receive it).
  - **`PRICE_DRIFT_SMTP_URL`** + **`PRICE_DRIFT_SMTP_FROM`** + **`PRICE_DRIFT_SMTP_TO`** — all three together to also (or instead) email the result.
  - The job exits non‑zero if a delivery fails too, so a broken notification channel can't hide a broken price.
- Run the check manually: `Actions → Price Drift Check → Run workflow`, or locally:
  ```bash
  NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... STRIPE_SECRET_KEY=... \
  PRICE_DRIFT_WEBHOOK_URL=... node scripts/check-price-drift.cjs
  ```
  Locally, `PRICE_DRIFT_WEBHOOK_URL=https://ntfy.sh/test` is a safe way to try the phone push without touching real channels.
- **Monthly digest** — `.github/workflows/price-drift-monthly.yml` (1st of every month, 06:30 UTC) posts a summary of the past **30 nightly runs** to the same webhook/email channels, so you get one monthly health message instead of 30. Trigger it early with `Actions → Price Drift Monthly Summary → Run workflow`.
- The pure normalization/comparison logic lives in `src/lib/price-drift.ts` with unit tests in `src/lib/price-drift.test.ts`.

---

## Troubleshooting

| Symptom                                      | Likely Cause                                       | Fix                                                                   |
| -------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------- |
| `ERR_EMPTY_RESPONSE` on `/dashboard`         | Missing `SUPABASE_SERVICE_ROLE_KEY` env             | Set it in `.env.local`                                                |
| "Failed to create checkout session"          | Stripe keys missing or invalid                      | Set `STRIPE_SECRET_KEY`                                               |
| AI generation returns 500                    | No API key configured for the selected task          | Go to `/dashboard/settings/ai` and add a key                          |
| Middleware redirect loop                     | Cookie not being persisted                          | Ensure Supabase URL uses `https://` (not `localhost`)                 |
| `npm run build` fails in CI                  | Missing env vars                                    | Add `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to CI  |
| Custom domain not showing branded portal     | Domain not set in white‑label settings              | Save it in `/dashboard/settings/white-label`                          |

---

## License

Proprietary — all rights reserved.