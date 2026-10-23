# HANDOFF - Round 18: Gaps & Build Plan (2026-08-03)

For a fresh AI instance. Authoritative roadmap from rounds 14-17 audits.

## 0. Quick Facts

- Project: Agency OS - multi-tenant SaaS for SEO/web agencies
- Stack: Next.js 16.2.12, TS, Tailwind 4, shadcn/ui, Supabase, Stripe, Inngest
- Live app: https://platform.blissmedialab.com (root blissmedialab.com = separate WordPress, DON'T touch)
- VPS: 154.12.243.255 / platform / <REDACTED - see git-ignored secrets file> (plink/pscp)
- App dir: /var/www/vhosts/blissmedialab.com/agency-os
- DB: Supabase ref axqcmiisztnqcntprhdy
- Roles: super_admin(4), agency_admin(3), agency_editor(2), client(1)
- Auth: proxy.ts middleware -> user_roles -> cookies x-tenant-id/x-user-role/x-user-id/x-user-email
- 11 Employees: Penny(SEO Content), Eva(Inbox/Calendar), Sonny(Social), Stan(LeadGen), Rachel(Voice), Scout(SEO Audit), Dev(WebDev), Gauge(Analytics), Nina(ProjectMgmt), Juno(Reputation/GBP), Linda(Legal-planned)

## 1. DONE (verify only)

Round 15: webspinnerandroid=super_admin; mike=agency_admin in "Mike Media"; trial licenses flagged is_trial; Admin All Users w/ level dropdown; admin gated.
Round 16-17: /help live w/ 7 tabs (Overview/Setup/Manual/AI Employees/Case Study/Roadmap/FAQ); email honesty (read+calendar built, replies+IMAP planned); Help links everywhere.
Build ID: 0hjFM8canCBRlx5Ldd4UhX.

## 2. CRITICAL - ACTIVE BUG

### 2a. super_admin locked out of content generation (403 Forbidden)
Files: src/app/api/generate-content/route.ts (line 15) + src/app/api/tasks/blog-generation/route.ts.

const ALLOWED_ROLES = ["agency_admin", "agency_editor"] as const;

super_admin is NOT in the list, so webspinnerandroid gets 403 after the Round-15 promotion. The license revoke/re-add was coincidental.

Fix: add "super_admin" to ALLOWED_ROLES in both files, OR replace with await requireRole("agency_editor") from @/lib/auth (honors hierarchy).

### 2b. Users not showing in Admin All Users
getAllUsers() in src/app/dashboard/admin/actions.ts maps user_roles rows; may miss users with no role row or orphaned rows. Verify listUsers pagination (perPage 1000). Fix: left-join from auth.users list incl. users with no role ("pending"/"unassigned").

## 3. PHASES - STEP-BY-STEP BUILD PLAN

### PHASE A - UNLOCK + DATA INTEGRITY (small, urgent)
1. Fix 2a (super_admin ALLOWED_ROLES) in both route files
2. Fix 2b (All Users completeness)
3. Verify 403 gone: login as webspinnerandroid -> Generate Content -> submit topic
4. Deploy

### PHASE B - USER-REPORTED FEATURE BUGS
**B1. Brand Profile customization must work for non-admins (Editors)**
- Files: src/app/dashboard/workspaces/[id]/brand-profile/page.tsx, src/lib/brand-profile.ts, src/lib/auth.ts
- Current: custom instructions / voice / tone / persona only save for admins/super-admins
- Fix: requireRole("agency_editor") on brand-profile save

**B2. Facebook content renders as raw JSON**
- Files: src/app/api/generate-content/route.ts lines 217-230 (JSON.parse fallback wraps raw text), src/lib/publishing/socialPublisher.ts
- Fix: on JSON.parse failure do NOT store raw JSON as caption; extract plain-text fallback or regenerate; validate non-JSON before publish

**B3. No content generation for Google Business Profile (GBP)**
- Add "GBP post" generation option reusing generateStructuredOutput w/ a gbp-post task; target connected google_business_profiles rows
- Add publish-to-GBP (queue for Juno/Reputation manager)

**B4. Publish buttons on generated content + Recent Content**
- Files: src/app/dashboard/generate/page.tsx (result cards), src/app/dashboard/recent-content.tsx, src/lib/publishing/socialPublisher.ts
- Add Publish + Schedule to generated blog/social result cards and each Recent Content row; wire to POST /api/publish

### PHASE C - ADMIN & USER MANAGEMENT FOR PRODUCTION
**C1. Full tenant management (Admin):** edit name/slug/domain, suspend/unsuspend, view members + licenses
**C2. Full user management (Admin):** change email, role, tenant; reset password (Supabase auth.admin.updateUserById); enable/verify 2FA (auth.admin.generateLink + TOTP flow); deactivate user
**C3. License management beyond create/revoke:** edit seats, plan_id, status, expires_at, limits in src/app/dashboard/admin/page.tsx
**C4. Client profile page (self-service):** /portal/profile (or /dashboard/profile) - update contact info, change own password (supabase.auth.updateUser), view portal sections

### PHASE D - PLATFORM GAPS (FROM AUDIT)
**D1. Clients management page - NONE exists.** Build /dashboard/clients: CRUD (only API /api/clients + dashboard filter today). Add nav link.
**D2. Team/Members page** - Admins invite/add agency_editor + client users, assign, manage seats. Add /dashboard/team + inviteUser action (create auth user + user_roles row, or email invite)
**D3. Verify Inngest workers run on VPS** - src/lib/inngest/functions/* (publishScheduledPosts, processSequences, syncInboxes, syncSocialInbox, fetchAnalytics, monthlyBillingReset). Check serve endpoint + crontab/pm2. Critical for "employees" narrative.
**D4. Recent Images fallback** - src/app/dashboard/page.tsx lines 37-41: use default workspace id instead of .is("workspace_id", null)
**D5. AI Settings shows wrong DeepSeek models** - migration 013 added deepseek-v4-pro/flash but UI shows old deepseek-chat/deepseek-reasoner. Filter to V4
**D6. Agents/Employees dashboard UI** - 11 employees are backend-only. Build /dashboard/employees to view/enable/monitor (ties into D3)
**D7. Email replies + IMAP/POP** - add gmail.send + Mail.Send scopes, send/draft flow, IMAP/POP provider support (email_accounts platform enum)
**D8. Phase 5 integrations** - GSC rankings, Meta Insights, X Analytics, Webflow publishing, SEO-content enrichment (from HANDOFF-PHASE5.md)
**D9. Promo codes** - billing coupon support (not implemented)
**D10. White-label custom domain wiring** - verify DNS/proxy actually serves the portal on custom domain (Plesk vhost or per-tenant subdomain)

## 4. DEPLOY PATTERN (proven rounds 15-17)

Create deploy-roundXX.cjs at repo root:
- HOST=154.12.243.255 USER=platform PASS=<REDACTED - see git-ignored secrets file> BASE=/var/www/vhosts/blissmedialab.com/agency-os
- upload via pscp; then pkill -9 -f next-server; sleep 2; rm -rf .next
- cd BASE && npx next build > /tmp/bXX.log 2>&1 (NEVER pipe tail - write to file)
- (nohup node node_modules/next/dist/bin/next start -p 3000 > /tmp/nextjs.log 2>&1 < /dev/null &)
- smoke: curl localhost:3000/{page} + chunk404 check + BUILD_ID; public: curl https://platform.blissmedialab.com/{page}

**DB migrations**: supabase CLI on VPS unreliable (016 never pushed). Use Node script w/ @supabase/supabase-js service role (see apply-user-management-fix.cjs, verify-db-check.cjs, fix-mike-license.cjs) - reads env from .env.local manually (no dotenv).

## 5. VERIFICATION CHECKLIST

**Phase A**: [ ] Generate works (no 403); [ ] All Users shows both accounts + unassigned
**Phase B**: [ ] Editor saves brand voice/tone/persona/custom; [ ] FB/Social posts plain text (no JSON); [ ] GBP generation option + publish; [ ] Publish/Schedule buttons on Generate + Recent
**Phase C**: [ ] Admin resets pw, 2FA, edits email/role/tenant; [ ] Modify license seats/plan/status/expiry; [ ] Client self-service profile (contact + password)
**Phase D**: [ ] /dashboard/clients CRUD; [ ] /dashboard/team invite works; [ ] Inngest runs on VPS; [ ] fresh signup Recent Images shows default workspace; [ ] AI Settings shows v4-pro/flash; [ ] /dashboard/employees lists 11; [ ] Eva sends replies; [ ] GSC/Meta/X/Webflow live; [ ] promo codes; [ ] custom domain serves portal

## 6. KEY FILE INDEX

| Concern | File |
| Roles/hierarchy | src/lib/auth.ts |
| Middleware/cookies | src/proxy.ts |
| Register/tenant creation | src/app/api/register/route.ts |
| Admin actions/users | src/app/dashboard/admin/actions.ts |
| Admin page | src/app/dashboard/admin/page.tsx |
| Generate content (403 bug) | src/app/api/generate-content/route.ts |
| Blog task route | src/app/api/tasks/blog-generation/route.ts |
| Email agent (Eva) | src/lib/inbox/archer.ts |
| Social inbox (Sonny) | src/lib/inbox/echo.ts |
| Leads agent (Stan) | src/lib/leads/cipher.ts |
| Voice agent (Rachel) | src/lib/voice/haven.ts |
| Media agent | src/lib/media/flux.ts |
| Social publisher | src/lib/publishing/socialPublisher.ts |
| WordPress publisher (Dev) | src/lib/publishing/wordpressPublisher.ts |
| SEO audit (Scout) + competitors | src/lib/seo/{auditor,competitors,deployCampaign}.ts |
| AI orchestrator (Penny) | src/lib/ai/orchestrator.ts + seo-prompts.ts |
| Inngest workers (Nina/Gauge) | src/lib/inngest/functions/* |
| Workspaces/brand/KB | src/lib/workspace.ts, brand-profile.ts, knowledgebase.ts |
| Dashboard images fallback bug | src/app/dashboard/page.tsx |
| Help Center | src/app/help/page.tsx |
| Migrations (schema) | supabase/migrations/001-017 |
