# Agency OS — Phase 5 Handoff
**Date**: 2026-08-01  
**For**: New instance to resolve remaining 3 issues

---

## What Was Fixed (Phase 4)

| Issue | Status | What Changed |
|---|---|---|
| Generate Content 500 error | ✅ Fixed | `proxy.ts` + `auth.ts` — switched from crashing header forwarding to cookie-based auth |
| SEO Campaigns 500 error | ✅ Fixed | Same auth fix |
| VPS crash on startup (Next.js 16) | ✅ Fixed | Removed `NextResponse.next({ request: { headers } })` pattern |
| SEO 504 Gateway Timeout | ✅ Fixed | nginx `proxy_read_timeout 300s` in Plesk |
| Google Imagen missing | ✅ Fixed | Seeded into production Supabase (`axqcmiisztnqcntprhdy`) |
| AI Settings — provider names | ✅ Fixed | Shows names, not UUIDs |
| Social / GBP OAuth warnings | ✅ Expected | Amber banners show missing env vars — by design |
| Blog too short (< 2500 words) | ✅ Fixed | Auto-retry with enriched prompt + 32K maxTokens |
| Proxy mode not active in Plesk | ✅ Configured | nginx passes to localhost:3000 |

---

## Remaining Issues (3)

### Issue 1: Dashboard "Recent Content" Empty After Generating

**Symptom**: Generate Content works, saves to DB, but the dashboard still shows "No content yet."

**Root cause candidate**: `src/app/dashboard/page.tsx` uses `getTenantIdFromSession()` which queries `user_roles` by `user_id`. The Supabase user session may not be persisting correctly through the cookie-based auth flow, or the `posts` table query returns empty despite records existing.

**File**: `src/app/dashboard/page.tsx` (lines 15-41)

**Debug steps**:
1. SSH into VPS, check `/tmp/nextjs.log` for errors
2. Run this query in Supabase SQL Editor to verify posts exist:
```sql
SELECT id, tenant_id, content->>'type' as type, status, created_at
FROM posts
ORDER BY created_at DESC
LIMIT 10;
```
3. Check if the dashboard page's `getTenantIdFromSession()` returns a valid tenant ID — add `console.log` temporarily
4. Verify the `posts` query isn't filtered by a client_id or status field that excludes drafts

---

### Issue 2: Image Generator API — Empty API Key (401)

**Symptom**: `/dashboard/generate-images` loads but returns: `Incorrect API key provided: ''`

**Root cause**: The `generateImage()` function in `src/lib/ai/orchestrator.ts` calls `getModelForTask(tenantId, "image_generation")` which looks up the configured model in `ai_settings` to get the API key. If no image generation provider is configured in AI Settings, or the API key field is empty string, the call fails with 401.

**Files**:
- `src/lib/ai/orchestrator.ts` — `generateImage()` (line 812), `getModelForTask()`  
- `src/app/api/generate-image/route.ts` — API route
- `src/app/dashboard/generate-images/page.tsx` — frontend

**Fix**: Configure an image provider in AI Settings with a valid API key:
1. Go to `/dashboard/settings/ai`
2. Under "Image Generation" task, select a provider (Google Imagen, OpenAI/DALL-E, or Stability AI)
3. Ensure the provider has a valid API key set
4. Or add `OPENAI_API_KEY` to `.env.local` on the VPS for DALL-E (the default fallback)

---

### Issue 3: SEO Campaigns Requires Valid UUID Client ID

**Symptom**: Typing "gb1" shows: `clientId must be a valid UUID (e.g. a1b2c3d4-e5f6-7890-abcd-ef1234567890)`

**Status**: This is fixed intentionally — the route now validates UUIDs before inserting. Previously it crashed the DB with a `22P02` error.

**User experience fix needed**: The SEO Campaigns page should either:
- Auto-fetch available clients from the DB and show a dropdown instead of a text input, OR
- Accept a client name/alias and resolve it to a UUID server-side

**File**: `src/app/dashboard/seo/campaigns/page.tsx` (line 251-259) and `src/app/api/seo/generate-campaign/route.ts` (lines 180-187)

---

## VPS Info

| Detail | Value |
|---|---|
| **URL** | https://platform.blissmedialab.com |
| **Server** | Contabo VPS (154.12.243.255) |
| **User** | `platform` (no sudo) |
| **App location** | `/var/www/vhosts/blissmedialab.com/agency-os/` |
| **Start command** | `node node_modules/next/dist/bin/next start -p 3000 > /tmp/nextjs.log 2>&1 & disown` |
| **Build command** | `cd /var/www/vhosts/blissmedialab.com/agency-os && npx next build` |
| **Kill old process** | `pkill -f "next start"` |
| **Web server** | Plesk → nginx → localhost:3000 |
| **Supabase** | `https://axqcmiisztnqcntprhdy.supabase.co` |
| **Logs** | `/tmp/nextjs.log` |

## Deploy Checklist (for any new files)

From Windows `agency-os` folder:
```
scp src/file.ts platform@154.12.243.255:/var/www/vhosts/blissmedialab.com/agency-os/src/file.ts
```

If adding a new directory, create it on VPS first:
```
ssh platform@154.12.243.255 "mkdir -p /var/www/vhosts/blissmedialab.com/agency-os/src/path/to/new/dir"
```

Then rebuild + restart:
```
ssh platform@154.12.243.255
cd /var/www/vhosts/blissmedialab.com/agency-os
npx next build
pkill -f "next start"
node node_modules/next/dist/bin/next start -p 3000 > /tmp/nextjs.log 2>&1 & disown
```

## Key Files

| File | Purpose |
|---|---|
| `src/proxy.ts` | Middleware — sets auth cookies (x-tenant-id, x-user-role, x-user-id, x-tenant-theme) |
| `src/lib/auth.ts` | `getTenantId()`, `getRole()`, `getClientId()` — reads from cookies |
| `src/app/dashboard/page.tsx` | Dashboard — "Recent Content" section |
| `src/app/dashboard/seo/campaigns/page.tsx` | SEO campaigns UI — full audit details on expand |
| `src/app/api/seo/generate-campaign/route.ts` | SEO campaign API — UUID validation, crawl, AI generation |
| `src/app/api/generate-image/route.ts` | Image generation API (new) |
| `src/app/dashboard/generate-images/page.tsx` | Image generation UI (new) |
| `src/lib/ai/orchestrator.ts` | AI routing — `generateImage()`, `callGoogleImagenAPI()` |