# Agency OS

**Multi‑tenant SaaS platform for digital agencies.**  
AI content generation · white‑labelled client portals · tiered SEO campaign proposals · social media scheduling · billing (Stripe) · analytics dashboard.

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