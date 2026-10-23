# Agency OS — Phase 4 Complete Handoff
**Date**: 2026-07-31
**For**: New AI instance — start here

---

## Quick Start
All code is on Windows at `C:\Users\Bliss Media Lab\Desktop\Clients\Platform\agency-os\`. The WSL2 dev server runs at `~/agency-os/`. Files must be synced from Windows to WSL before testing.

---

## What Changed This Session

### Phase 4 — Flux Creative Studio (6 new files)
| File | Purpose |
|------|---------|
| `supabase/migrations/012_flux.sql` | `media_assets` table with RLS |
| `src/lib/media/flux.ts` | Wraps orchestrator, persists generated media |
| `src/app/api/media/images/route.ts` | POST generate / GET list images |
| `src/app/api/media/videos/route.ts` | POST generate / GET list videos |
| `src/app/api/media/voice/route.ts` | POST generate / GET list voice |
| `src/app/api/media/assets/[id]/route.ts` | GET single / DELETE asset |

### Migration 013 — DeepSeek V4 Models
- Added `deepseek-v4-pro` and `deepseek-v4-flash` to `ai_models` table

### Bug Fixes (existing files modified)
| # | File | Fix |
|---|------|-----|
| 1 | `.env.local` | `OPENAI_API_KEY=` (empty — DeepSeek key gets used instead) |
| 2 | `src/proxy.ts` | Lines 64-75: base64 cookie decoding for login |
| 3 | `src/lib/supabase/server.ts` | `createServiceClient` uses service role (bypasses RLS) |
| 4 | `next.config.ts` | `experimental.serverActions.bodySizeLimit: "50mb"` |
| 5 | `src/lib/ai/orchestrator.ts` | 4 changes (see below) |
| 6 | `src/app/dashboard/settings/social/actions.ts` | Imports `SUPPORTED_PLATFORMS` from `./constants` |
| 7 | `src/app/dashboard/settings/social/constants.ts` | NEW — extracted platform list |

### Orchestrator Changes (src/lib/ai/orchestrator.ts) — 4 Fixes
1. **Line 392-401**: Changed `??` to `||` — empty `OPENAI_API_KEY=""` now correctly falls through to `DEEPSEEK_API_KEY`
2. **Line 407-416**: Added `getPlatformDefaultBaseUrlForType()` — returns `https://api.deepseek.com/v1` when OpenAI key is empty
3. **Line 376-378**: Default text model: `deepseek-v4-pro` (not flash — pro supports tool calling, flash doesn't)
4. **Line 680-683**: `generateStructuredOutput` auto-detects DeepSeek and uses JSON mode instead of `tool_choice` (DeepSeek's thinking mode rejects tool_choice)

---

## Remaining Known Issues
These were NOT fixed — note for next phase:

| Issue | Notes |
|-------|-------|
| AI Settings doesn't show DeepSeek V4 models | Migration 013 added them to DB, but old `deepseek-chat`/`deepseek-reasoner` rows are still the only ones shown. Need to check the AI settings page query |
| Brand profile "Apply preset" then customize | UI not implemented for customizer |
| No agents dashboard UI | 7 agents exist as backend libs/APIs, no frontend |
| No video/audio generation UI | Phase 4 APIs exist (`/api/media/*`), no frontend page |
| No promo codes | Not implemented |
| GSC integration | Planned for Phase 5 |
| Hydration error on generate page | LastPass browser extension injecting DOM — not a code bug |
| Old `deepseek-chat`/`deepseek-reasoner` models from migration 009 | These don't work with the DeepSeek API. Migration 013 added V4 models. These old rows should be deleted or the AI settings page should filter them |

---

## Sync Commands (Windows → WSL)
Run after making any changes on Windows:

```
cp "/mnt/c/Users/Bliss Media Lab/Desktop/Clients/Platform/agency-os/.env.local" ~/agency-os/.env.local
cp "/mnt/c/Users/Bliss Media Lab/Desktop/Clients/Platform/agency-os/src/proxy.ts" ~/agency-os/src/proxy.ts
cp "/mnt/c/Users/Bliss Media Lab/Desktop/Clients/Platform/agency-os/src/lib/ai/orchestrator.ts" ~/agency-os/src/lib/ai/orchestrator.ts
cp "/mnt/c/Users/Bliss Media Lab/Desktop/Clients/Platform/agency-os/src/lib/supabase/server.ts" ~/agency-os/src/lib/supabase/server.ts
cp "/mnt/c/Users/Bliss Media Lab/Desktop/Clients/Platform/agency-os/next.config.ts" ~/agency-os/next.config.ts
cp "/mnt/c/Users/Bliss Media Lab/Desktop/Clients/Platform/agency-os/src/app/dashboard/settings/social/actions.ts" ~/agency-os/src/app/dashboard/settings/social/actions.ts
```

### Create constants.ts on WSL (if missing):
```
cat > ~/agency-os/src/app/dashboard/settings/social/constants.ts << 'EOF'
export const SUPPORTED_PLATFORMS = [
  { id: "facebook",  name: "Facebook",  icon: "📘", color: "#1877F2", oauth: true  },
  { id: "instagram", name: "Instagram", icon: "📷", color: "#E4405F", oauth: true  },
  { id: "twitter",   name: "X (Twitter)", icon: "🐦", color: "#000000", oauth: false },
  { id: "linkedin",  name: "LinkedIn",  icon: "💼", color: "#0A66C2", oauth: false },
  { id: "youtube",   name: "YouTube",   icon: "▶️", color: "#FF0000", oauth: false },
  { id: "tiktok",    name: "TikTok",    icon: "🎵", color: "#000000", oauth: false },
  { id: "threads",   name: "Threads",   icon: "🧵", color: "#000000", oauth: false },
  { id: "pinterest", name: "Pinterest", icon: "📌", color: "#BD081C", oauth: false },
] as const;

export type SupportedPlatform = (typeof SUPPORTED_PLATFORMS)[number];
EOF
```

### Restart:
```
rm -rf ~/agency-os/.next
cd ~/agency-os && npm run dev
```

---

## Project Architecture
- **Stack**: Next.js 16 (Turbopack), TypeScript, Tailwind CSS 4, shadcn/ui, Supabase, Stripe, Inngest
- **Auth**: Supabase Auth → `src/proxy.ts` middleware → `user_roles` table for tenant mapping
- **AI**: `src/lib/ai/orchestrator.ts` — 3-tier resolution: DB mappings → tenant keys → env vars
- **DB**: 13 migrations on Supabase, RLS on every tenant-scoped table
- **Dev**: WSL2 Ubuntu at `~/agency-os/`, port 3000
- **Dev server kill issue**: `kill -9` corrupts `.next` Turbopack cache. Always `rm -rf .next` after a force kill.

## State
- **Agents**: 7 of 11 built
- **Routes**: 59
- **Migrations**: 13 (001-013)
- **Build**: `npx next build` passes on WSL (Windows `node_modules` was deleted by WSL copy)

## Next Phase: Phase 5 — Index + Gauge
~12 files: WordPress/Webflow publishing, Google Search Console, Meta Insights, X Analytics. No extra API keys needed.