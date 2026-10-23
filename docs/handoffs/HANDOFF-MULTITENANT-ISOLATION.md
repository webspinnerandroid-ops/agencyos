# HANDOFF — Multi-Tenant Isolation & RBAC (2026-08-03)

## Priority: CRITICAL — cross-tenant data exposure (security & privacy)

### Symptoms (user-reported)
- All content + SEO audits created by any user appear to every user
- Other users can see the Admin panel (only `webspinnerandroid@gmail.com` should access it)
- A newly created account sees clients, workspaces, blog settings, and AI settings from other users
- New account's dashboard loads fast only because the Recent Images column returns 0 rows (workspace fallback bug)

### Confirmed code findings

1. **AI Settings — global system providers leak**
   `src/app/dashboard/settings/ai/actions.ts`
   - `getProviders()` queries `ai_providers` with **no tenant_id filter** — global table; seeded system providers (DeepSeek, Google Imagen, DALL-E/Stability, etc. from migrations 003/009/013/015) are visible to **every user**.
   - `getModels()` queries `ai_models` with **no tenant filter** either.
   - No `is_system` / `tenant_id` column exists on `ai_providers` / `ai_models`, so there is no way to distinguish "system" providers from per-tenant ones.
   - `tenant_api_keys` and `task_model_mappings` ARE correctly tenant-scoped (`.eq("tenant_id", tenantId)`).

2. **Admin panel — page not gated (server actions ARE gated)**
   `src/app/dashboard/admin/page.tsx` + `src/app/dashboard/admin/actions.ts`
   - All server actions call `requireSuperAdmin()` (throws unless `role === "super_admin"`), so data is protected server-side.
   - The **page itself has no server-side guard** and the dashboard nav likely renders the "Super Admin" link for everyone → non-admin users see the panel shell and get error flashes on load. Must be: redirect/hide unless `role === "super_admin"`.

3. **Recent images — wrong workspace fallback**
   `src/app/api/generate-image/recent/route.ts`
   - When `getCurrentWorkspaceId()` returns null (no cookie), it falls back to `.is("workspace_id", null)`.
   - New tenants have a **default workspace** (created at registration in `/api/register`) whose images have a real `workspace_id` — so a fresh account sees **0 images** ("page loads fast because nothing loads").
   - Fix: fall back to the tenant's **default workspace id** (`workspaces.where tenant_id=me, is_default=true`) instead of NULL-only.

4. **Blog settings / GBP / workspaces — VERIFY in fix round**
   - `src/app/dashboard/settings/blog/*` — `blog_platforms` queries were not fully verified for `.eq("tenant_id", ...)`.
   - `src/app/dashboard/settings/gbp/*` — client/platform queries need per-tenant verification.
   - `src/app/dashboard/workspaces/*` — `src/lib/workspace.ts` `getWorkspaces()` filters by tenant correctly, but the UI pages / any `/api/workspaces` routes need verification.

### Root-cause investigation - RESULT (2026-08-03, confirmed via Supabase query)

```sql
SELECT u.email, ur.tenant_id, ur.role, t.name AS tenant_name
FROM auth.users u
JOIN user_roles ur ON ur.user_id = u.id
JOIN tenants t ON t.id = ur.tenant_id
ORDER BY u.email;
```

| email | tenant_id | role | tenant_name |
|---|---|---|---|
| mike@webspinnermedia.com | 0d564113-5b76-42c7-8e81-310ac469fd07 | agency_admin | My New Agency |
| webspinnerandroid@gmail.com | 0d564113-5b76-42c7-8e81-310ac469fd07 | agency_admin | My New Agency |

**Both users share the SAME tenant** (`0d564113-...` "My New Agency") - so every tenant-scoped query (posts, SEO, clients, workspaces, images, blog platforms) legitimately returns the same rows to both users. The data "leak" is the **tenant assignment**, not (primarily) the query filters: the second account (mike@webspinnermedia.com) was registered/assigned into the EXISTING tenant instead of a brand-new one. Fix: registration/account-creation must always create a fresh tenant + default workspace + default brand profile and assign the new user to it.

**No super_admin exists at all** - both users are agency_admin. The Admin panel's requireSuperAdmin() rejects both, yet the page shell renders for everyone (no page-level gate). Promote `webspinnerandroid@gmail.com` to `role='super_admin'` and keep `mike@webspinnermedia.com` as agency_admin (ideally in their own fresh tenant).

### Fix plan — Round 15 (DONE 2026-08-03)

1. **Admin gate** DONE: new server-side redirect in `src/app/dashboard/admin/layout.tsx`; "Admin" nav link hidden for non-super_admins in `src/app/dashboard/layout.tsx`.
2. **Super admin + tenant split** DONE: `webspinnerandroid@gmail.com` = super_admin; `mike@webspinnermedia.com` = agency_admin in his own fresh "Mike Media" tenant (with workspace, brand profile, trialing subscription, trial license).
3. **User level management** DONE: new `getAllUsers()` + `assignLevel(userId, role)` actions; "All Users" card on `/dashboard/admin` shows Email | Level (dropdown to assign User/Client, Editor, Admin, Super Admin) | Tenant | Plan | Trial badge.
4. **Trial display** DONE: registrations issue licenses with `metadata.is_trial=true`; existing `-TRIAL` licenses backfilled; Trial badge derived from `metadata.is_trial` + `subscription.status='trialing'` (licenses.status keeps CHECK-valid 'active').
5. **Deployment** DONE: `node deploy-round15.cjs` + `deploy-round15b.cjs` + `deploy-round15c.cjs`; BUILD_ID `T-bFx6qQc_yNn-o9I5JaAX`; admin unauth redirects 307 to `/login`.

### Deploy pattern

`node deploy-round15.cjs` — same as round10/11/12/13:
- PSCP upload changed files
- Run `node apply-user-management-fix.cjs` (DB data fix)
- `pkill -9 -f next-server` + port check → `rm -rf .next`
- `npx next build > /tmp/b15.log 2>&1` (logfile, never piped through tail)
- `(nohup node node_modules/next/dist/bin/next start -p 3000 > /tmp/nextjs.log 2>&1 < /dev/null &)`
- Verify BUILD_ID + zero 404s + per-page smoke tests

### Post-fix verification checklist

- [x] DB: webspinnerandroid = super_admin; mike = agency_admin in "Mike Media" tenant; trial license flagged `is_trial=true`
- [ ] Login as `webspinnerandroid@gmail.com` → Admin panel visible, all tenants listable
- [ ] Admin → All Users: assign level dropdown works (User/Client, Editor, Admin, Super Admin)
- [ ] Login as a different user → no Admin link/panel; dashboard shows ONLY own content/images/SEO/clients
- [ ] New signup (incognito) → lands in a brand-new tenant with default workspace, license flagged `is_trial=true`, shows Trial badge in Admin → All Users
- [ ] Blog settings → only own `blog_platforms` visible
- [ ] Workspaces + GBP → only own tenants/workspaces/clients visible
