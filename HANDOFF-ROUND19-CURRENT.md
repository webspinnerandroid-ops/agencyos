# HANDOFF — Round 19: Current State & Full Remaining Roadmap (2026-08-04)

Authoritative handoff for a fresh instance. Extends HANDOFF-ROUND18-GAPS.md with verified session changes.

## 0. Quick Facts
- App: Agency OS - multi-tenant SaaS for SEO/web agencies. Next.js 16.2.12, TS 5.8, Tailwind 4, shadcn/ui, Supabase, Stripe, Inngest, Google Gemini images.
- Live: https://platform.blissmedialab.com (root blissmedialab.com = separate WordPress, DO NOT touch).
- VPS: 154.12.243.255 / user platform / app dir /var/www/vhosts/blissmedialab.com/agency-os (plink/pscp).
- DB: Supabase ref axqcmiisztnqcntprhdy.
- Roles: super_admin(4) > agency_admin(3) > agency_editor(2) > client(1); requireRole() is hierarchy-aware (src/lib/auth.ts). No ALLOWED_ROLES gate remains.
- Auth: src/proxy.ts middleware -> user_roles -> cookies x-tenant-id/x-user-role/x-user-id/x-user-email (NOT JWT claims).
- Test accounts: webspinnerandroid = super_admin; mike/mikeweb = agency_admin (Mike Media).
- Image provider: default gemini-2.5-flash-image (Nano Banana) via generateContent; Imagen 4 :predict branch kept for imagen-* models.
- NOT a git repo - backups in Platform/backups/ are the only safety net (section 6).

## 1. DONE & VERIFIED (this session)
- Gates green: npm test (3/3), npm run lint (0 errors, 284 warnings = backlog), npx tsc --noEmit (clean), npx next build (73/73 pages).
- Test toolchain installed (was missing, broke CI test): vitest 3.2.7, vite 6.4.3, @vitejs/plugin-react 4.7.0, @testing-library/jest-dom 6.9.1, jsdom 26.1.0.
- TS enforced: next.config.ts no longer ignores build errors; all 20 pre-existing type errors fixed.
- Blog JSON fix: removed hard 2500-word demand that truncated JSON ('Failed to parse JSON'). Word target now brand-aware (default 1200, cap 2000). Orchestrator salvages truncated JSON.
- super_admin 403 on Generate Content: already fixed via hierarchy-aware requireRole.
- Brand Profile populates for editors: getCurrentWorkspaceId() falls back to tenant default workspace when header/cookie missing.
- Google image generation works (user-confirmed): default = gemini-2.5-flash-image (Nano Banana); model-family routing; Imagen aspect-ratio normalization (1024x1024->1:1, 1792x1024->16:9, 1024x1792->9:16).
- Env: .env.example/.env.local.example synced; .gitignore covers .env*; GOOGLE_API_KEY in local .env.local.
- Stale-cache gotcha: rmdir /s /q .next then restart dev (fixed false 'lucide-react' and validator.ts errors).

## 2. REMAINING - Repairs & Bug Fixes (ordered)
1. Mobile navigation (user-confirmed): menu disappears on narrow screens. src/components/MobileNav.tsx exists but is NOT wired. Fix: breakpoint + hamburger/fallback.
2. Facebook/social raw-JSON captions (B2): generate-content/route.ts fallback can store raw JSON as caption. Fix: plain-text fallback / validate before publish.
3. Admin All Users completeness (2b): dashboard/admin/actions.ts misses role-less users. Fix: left-join from auth.users.
4. AI Settings old DeepSeek models (D5): filter to deepseek-v4-pro/flash.
5. Dashboard Recent Images fallback (D4): use default workspace id instead of .is('workspace_id', null).
6. React Compiler 'accessed before declaration' (real): generate-images/page.tsx (loadWorkspaces) + brand-profile/page.tsx (selectProfile) - move declarations above effects.
7. Lint backlog (284 warnings): no-explicit-any (~80), set-state-in-effect, no-unused-vars, no-unescaped-entities, img->next/image. Fix progressively; eslint.config.mjs keeps CI green.
8. Rotate pasted GOOGLE_API_KEY (live secret in chat): regen in Google AI Studio; update local + VPS .env.local.

## 3. REMAINING - Complete Platform Development (in order)
### PHASE 1 - Deploy to Production
- Proven deploy-roundXX.cjs pattern (pscp -> pkill -9 -f next-server -> rm -rf .next -> npx next build -> nohup next start -p 3000).
- CRITICAL: set GOOGLE_API_KEY in VPS agency-os/.env.local BEFORE rebuild.
- Smoke: curl localhost:3000 pages + live site; generate-content; generate-images; brand-profile save.
### PHASE 2 - Multi-Tenant Isolation Hardening (CRITICAL - before more client features)
- RLS dead: policies use auth.jwt()->tenant_id but claim never set (cookies only). Set claim OR use getSupabaseWithTenant() + explicit .eq('tenant_id',...) everywhere.
- ~38 files use SUPABASE_SERVICE_ROLE_KEY (bypasses RLS). Use anon/RLS for tenant reads/writes; service-role only in trusted jobs (Inngest/webhooks).
- Audit src/lib/encryption.ts + lib/leads/cipher.ts (IV handling, key derivation; no decrypted data to client).
- Rate limit public AI routes + register anti-abuse.
- Rotate VPS password in HANDOFF-ROUND18-GAPS.md; move creds to git-ignored file. Re-run security audit.
### PHASE 3 - SEO & AI Content Logic Correctness
- Stop fabricated metrics: seo/generate-campaign/route.ts + seo-prompts.ts invent searchVolume/difficulty/rankings/ROI/DA/+35% from empty audit (auditor.ts keywordRankings:[]). Source real data / mark estimates / omit.
- Brand-profile enforcement: word target respects max_word_count; add avoid_words/prefer_words/required_sections validation + retry.
- Upgrade audit rules (lib/seo/auditor.ts): mobile viewport, Core Web Vitals, schema.org, indexability, internal-link quality, duplicates, AEO/GEO readiness; kill meta keywords. Apply skills: seo-audit, ai-seo, programmatic-seo.
- Content: internal links, FAQ/HowTo + Article JSON-LD, thin-content + keyword-stuffing lint.
### PHASE 4 - Admin & User Management
- Tenant: edit name/slug/domain, suspend/unsuspend, members + licenses.
- User: email/role/tenant, password reset, 2FA, deactivate.
- License: seats/plan/status/expiry/limits beyond create/revoke.
- Client self-service profile (/portal/profile). Build /dashboard/clients CRUD + /dashboard/team invite (API exists, no UI).
### PHASE 5 - Platform Gaps (employees/integrations)
- Verify Inngest workers on VPS (serve + pm2/crontab): publishScheduledPosts, processSequences, syncInboxes, syncSocialInbox, fetchAnalytics, monthlyBillingReset.
- /dashboard/employees UI (11 employees backend-only).
- Email: gmail.send + Mail.Send scopes, send/draft, IMAP/POP (email_accounts platform enum).
- GBP: content generation option (user-requested) + publish queue.
- Phase-5 integrations: GSC, Meta, X, Webflow, SEO enrichment (per HANDOFF-PHASE5.md).
- Promo codes / billing coupons; white-label custom-domain DNS/proxy verification.
### PHASE 6 - Final Cleanup & Ship
- Delete junk files at repo + agency-os root: ({status, console.log('page.tsx, console.log(k+', console.log('QRYERR', c, testwrite.txt, git-status.txt, git-check.txt.
- Move deploy/diag .cjs/.txt into scripts/ or git-ignore them.
- Optional git init + baseline commit. Update README.md, AGENTS.md, CLAUDE.md, refresh this HANDOFF.

## 4. Key File Index
- Roles/requireRole: src/lib/auth.ts
- Middleware/cookies: src/proxy.ts
- Workspaces + default fallback: src/lib/workspace.ts
- Brand profile: src/lib/brand-profile.ts, brand-profile-utils.ts
- Content generation (JSON+word): src/app/api/generate-content/route.ts
- AI orchestrator (providers/images/JSON): src/lib/ai/orchestrator.ts
- SEO prompts (fabricated metrics): src/lib/ai/seo-prompts.ts, src/app/api/seo/generate-campaign/route.ts
- SEO audit: src/lib/seo/auditor.ts
- Admin: src/app/dashboard/admin/actions.ts, page.tsx
- Image UI: src/app/dashboard/generate-images/page.tsx
- Mobile nav (needs wiring): src/components/MobileNav.tsx
- ESLint: eslint.config.mjs | Tests: vitest.config.ts, src/test-setup.ts
- Migrations/RLS: supabase/migrations/ (016 via script, not CLI)
- Backups: Platform/backups/ + RESTORE-GUIDE-2026-08-04.md

## 5. Verification Checklist (after ANY change)
cmd: cd agency-os -> npm test -> npm run lint -> npx tsc --noEmit -> (stop dev) npx next build -> npm run dev
Browser smoke: webspinnerandroid + mikeweb; /dashboard/admin gated; blog gen (no Failed to parse JSON); social caption plain text; Generate Images (Nano Banana); brand-profile fields+Save; SEO audit+campaign; new tenant register; two-browser isolation. VPS: ps aux | grep next-server; pm2 list; crontab -l.

## 6. Backups (safety net until git init)
Platform/backups/: agency-os-BACKUP-2026-08-04.tar.gz (full pre-change) + agency-os-SNAP-*.tar.gz + RESTORE-GUIDE-2026-08-04.md. Restore: tar -x -f backups\agency-os-BACKUP-2026-08-04.tar.gz then npm install. node_modules/, .next/, tsconfig.tsbuildinfo excluded.
