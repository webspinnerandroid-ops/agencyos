# Agency OS — Unresolved Issues Handoff
**Date**: 2026-08-01  
**For**: New instance to fix remaining bugs

---

## Current State

| Page/Section | Status | Error |
|-------------|--------|-------|
| Login | ✅ Working | |
| Dashboard loads | ✅ Working | |
| AI Settings — provider dropdown | ✅ Fixed | No longer shows UUIDs |
| AI Settings — Google Imagen option | ❌ Missing | Migration not pushed to Supabase |
| Social Accounts — OAuth warnings | ✅ Fixed | Shows amber banner for missing env vars |
| GBP Settings — OAuth warnings | ✅ Fixed | Shows amber banner for missing env vars |
| Generate Content | ❌ Broken | `Unexpected token '<', "<html> <h"... is not valid JSON` |
| SEO Campaigns | ❌ Broken | `Unexpected token '<'` + `504 Gateway Time-out` |
| SEO nginx timeout | ❌ Not fixed | 504 on long SEO requests |

---

## Issue 1: Generate Content & SEO Campaigns — `Unexpected token '<'`

**Symptom**: Client fetches `/api/generate-content` or `/api/seo/generate-campaign`, gets HTML `<html>` instead of JSON.

**Root cause candidate**: Middleware (`src/proxy.ts`) sets authentication headers (`x-tenant-id`, `x-user-role`) as **response headers** but route handlers read them via `headers()` which reads **request headers**. The route handler's `getTenantId()` sees `null` and throws, causing a Next.js error page (HTML).

**Attempted fix**: Changed middleware to forward headers as request headers via `NextResponse.next({ request: { headers: requestHeaders } })`. This fix is in `src/proxy.ts` locally but the deploy is crashing the Next.js process (`Exit 1` with no visible error in background mode).

**What a new instance should check**: Run the app in **foreground mode** on the VPS to see the crash error:
```bash
cd /var/www/vhosts/blissmedialab.com/agency-os
node node_modules/next/dist/bin/next start -p 3000
```
The crash is likely a type issue with the `NextResponse.next({ request: { headers: requestHeaders } })` pattern — possibly the `headers` object passed to `NextResponse.next()` doesn't match Next.js's expected type.

**Alternative approach**: Instead of modifying proxy.ts, modify `getTenantId()` in `src/lib/auth.ts` to also check response headers or use a different pattern. Or use `cookies()` to pass the tenant ID instead of headers.

---

## Issue 2: VPS App Crashes on Startup

**Symptom**: After deploying the archive with the proxy fix, `node node_modules/next/dist/bin/next start -p 3000` exits with code 1. No visible error in background logs.

**How to debug**: Run in foreground as described above. Check `/tmp/nextjs.log` for the full stack trace.

---

## Issue 3: Google Imagen Provider Not Available

**Symptom**: AI Settings dropdowns don't show "Google Imagen" as a provider option.

**Root cause**: Migration `supabase/migrations/015_seed_google_imagen.sql` exists locally but hasn't been pushed to Supabase.

**Fix**: Run the SQL in Supabase Dashboard → SQL Editor:
```sql
INSERT INTO ai_providers (id, name, base_url, type) VALUES
  ('00000000-0000-0000-0000-000000000107', 'Google Imagen', 'https://generativelanguage.googleapis.com/v1beta', 'image')
ON CONFLICT (id) DO NOTHING;

INSERT INTO ai_models (id, provider_id, model_identifier, supported_tasks) VALUES
  ('17000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000107', 'imagen-3.0-generate-001', ARRAY['image_generation'])
ON CONFLICT (id) DO NOTHING;
```

The code for `callGoogleImagenAPI()` is already in `src/lib/ai/orchestrator.ts`. It uses the Google GenAI REST API with the same Google API key used for Gemini text models.

---

## Issue 4: SEO Campaign 504 Gateway Time-out

**Symptom**: SEO campaign generation takes 2+ minutes but nginx proxy times out before the response.

**Root cause**: Plesk-managed nginx has default 60-second timeout.

**Fix**: In Plesk admin panel (https://platform.blissmedialab.com:8443) → Websites & Domains → platform.blissmedialab.com → Apache & nginx Settings → Additional nginx directives. Add inside the `location /` block:
```nginx
proxy_read_timeout 300s;
proxy_connect_timeout 60s;
proxy_send_timeout 300s;
```

The `platform` user cannot sudo, so this must be done through Plesk.

---

## Issue 5: OAuth Env Vars Missing (Expected)

Both Social Accounts and GBP Settings pages correctly warn that OAuth env vars are not set:
- `NEXT_PUBLIC_META_APP_ID` / `META_APP_SECRET` (Meta Facebook/Instagram)
- `TWITTER_CLIENT_ID` / `TWITTER_CLIENT_SECRET`
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`

These are **not bugs** — they're working as designed. The vars just need to be added to `.env.local` on the VPS when the user is ready to connect those platforms. The pre-check code is in `src/app/dashboard/settings/social/actions.ts` (function `checkOAuthConfig()`).

---

## Key Files for Debugging

| File | Purpose |
|------|---------|
| `src/proxy.ts` | Middleware — auth header forwarding (lines 100-118) |
| `src/lib/auth.ts` | `getTenantId()`, `getRole()` — reads x-tenant-id from headers |
| `src/lib/ai/orchestrator.ts` | AI provider routing, `generateText()`, `generateStructuredOutput()`, `callGoogleImagenAPI()` |
| `src/app/api/generate-content/route.ts` | Generate content API route |
| `src/app/api/seo/generate-campaign/route.ts` | SEO campaign API route |
| `src/app/dashboard/generate/page.tsx` | Generate content frontend |
| `src/app/dashboard/settings/social/actions.ts` | Social OAuth actions + `checkOAuthConfig()` |
| `src/app/dashboard/settings/social/page.tsx` | Social accounts settings page |
| `src/app/dashboard/settings/gbp/page.tsx` | GBP settings page |
| `src/app/dashboard/settings/ai/page.tsx` | AI settings page |
| `supabase/migrations/015_seed_google_imagen.sql` | Google Imagen seed data |

## VPS Info

| Detail | Value |
|--------|-------|
| URL | https://platform.blissmedialab.com |
| Server | Contabo VPS (154.12.243.255) |
| User | `platform` (no sudo) |
| App location | `/var/www/vhosts/blissmedialab.com/agency-os/` |
| Process | `node node_modules/next/dist/bin/next start -p 3000` |
| Logs | `/tmp/nextjs.log` |
| Web server | Plesk → nginx → localhost:3000 |
| Deploy method | `pscp` archive → SSH extract → build → start |

## Fixes Already Applied (in local files)

- `credentials: "include"` on all dashboard fetch calls (5 pages, 10 calls)
- Provider dropdown shows names not UUIDs
- API key validation in orchestrator before calls
- OAuth pre-check warnings on social/GBP pages
- `.env.local.example` created
- Google Imagen `callGoogleImagenAPI()` function in orchestrator