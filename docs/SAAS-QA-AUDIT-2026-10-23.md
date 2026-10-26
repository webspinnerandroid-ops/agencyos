# saas-qa-audit — End-to-End QA & Persona Validation

*Run 2026-10-23 · `agency-os` @ `b83642a` · Next.js 16.2.12 dev server on :3100 · live Supabase project `axqcmiisztnqcntprhdy` · Chromium 153 headless · America/Denver*

Executed against the four checklist areas: database integrity & multi-tenancy, AI content engine,
scheduling engine, and UI/UX responsiveness. Every test is now part of the repo; every row created
by the run was deleted and verified gone.

---

## 1. Scorecard

| Checklist area | Verdict | Notes |
|---|---|---|
| **1. FK cascades (client workspaces)** | ✅ Pass | `workspace → client.workspace_id = NULL`, `client → posts.client_id = NULL` (content preserved), `tenant → 5 child tables` all cascade to zero. Verified live, not just in DDL. |
| **1. RLS isolation** | ⚠️ Pass by accident | A tenant's own authenticated user reads **0 rows** from `clients` through PostgREST. Cross-tenant API probes all rejected. But the isolation is **app-layer only** — the policies deny everything, so RLS never proves or enforces tenancy. |
| **2. AI engine** | ✅ Pass | 401 unauthenticated; 10 malformed bodies → 400 then **429 on the 11th** (limit 10/min); 2 concurrent generations → **200/200 in 50.1s**, distinct drafts, 4 ledger rows, **$0.0009**, model `deepseek-v4-flash`. |
| **2. Streaming / timeout boundaries** | ⚠️ N/A | No route streams (`ReadableStream` appears nowhere). Generation is one buffered JSON response; the client's only timeout is the browser's. |
| **3. Timezone conversion** | ❌ Defect | Offset maths is correct, and `16:00Z → 10:00 AM` rendered correctly in America/Denver. **But** a slot across a DST boundary is stored one hour off (see QA-3). |
| **3. Worker recovery (500 / rate-limit)** | ⚠️ Partial | Retry ladder, backoff, claim-before-work and escalation logic are covered by unit tests (`retryFailedPublishes.test.ts`). Not exercised end-to-end here: it needs a live webhook target + host cron, both out of scope for a local run. |
| **4. UI/UX responsiveness** | ❌ Defects | 5 pages × 3 viewports: **no horizontal overflow**, headings render, bottom nav targets ≥44px, 40 nav links all <400. Two calendar defects (QA-1, QA-2) and one a11y defect (QA-4). |
| **4. Calendar drag-and-drop** | ❌ Missing | Zero draggable elements; no drop handlers. Rescheduling is: open post → change date → save. |

**Totals:** 44 tests across three suites · **43 pass** (including 3 expected-failure pins and 2 defect pins
that pass while documenting a bug) · **1 environment failure** (QA-6) · **3 open product defects**
(QA-1, QA-2, QA-3) · **2 accessibility/feature gaps** (QA-4, QA-5).

---

## 2. Defects (ordered by user impact)

### QA-1 · P1 — Calendar chips render with no title (blank entries)
**Where:** `/dashboard/calendar` → month grid · `src/app/api/posts/route.ts` + `ContentCalendar.tsx:313`
**Evidence:** a seeded post at `2026-10-23T16:00Z` appears in the grid but its chip shows only the
"Scheduled" pill. `expect(chip.innerText).toContain(title)` fails (pinned as `test.fail`).
**Cause:** `/api/posts` stopped selecting the `content` blob for performance and now projects
`content->title` / `content->type`, returning them as **top-level** `title` / `type`.
`CalendarPost` still declares `content` and renders `excerptFromContent(post.content)` →
`undefined` → empty string for every chip.
**Fix (one place):** map the API row into `CalendarPost` in `calendar/page.tsx`:

```ts
fetchedPosts = (data.posts ?? []).map((p: any) => ({
  ...p,
  content: { type: p.type, title: p.title, caption: p.caption },
}));
```
(Or return `jsonb_build_object('type', content->'type', 'title', content->'title', 'caption', content->'caption') as content` from the API — but the client-side map is the smaller diff and keeps the payload slim.)

### QA-2 · P1 — Post dialog says "No content" and never loads the body
**Where:** same pair · `ContentCalendar.tsx:420-455`
**Evidence:** dialog text is `Post Detail · October 23, 2026 at 10:00 AM · Status: Scheduled · Content: No content`.
**Cause:** the lazy body fetch is gated on `parsed?.type === "blog" && typeof parsed.body !== "string"`.
`parsed` is `null` because `post.content` is missing (QA-1), so the fetch never fires and the modal is
permanently empty — even though `GET /api/posts/[id]` returns the full `content`.
**Fix:** fixed by QA-1 (the map restores `content.type`), plus make the gate fetch when
`content == null` as well:

```ts
const needsBody = !parsed || (parsed.type === "blog" && typeof parsed.body !== "string");
```

### QA-3 · P1 — DST-boundary scheduling is one hour off
**Where:** `src/components/PublishButton.tsx:138` → `normalizeScheduledAt(..., new Date().getTimezoneOffset())`
**Evidence:** July offset (360) applied to a December slot produces `15:00Z`; the correct December
offset (420) produces `16:00Z`. Pinned in `saas-qa-integrity.spec.ts`.
**Impact:** an agency scheduling after the DST switch (or months ahead of it) publishes an hour early/late.
**Fix:** derive the offset from the target date, not now:

```ts
const target = new Date(scheduledLocal);           // "2026-12-15T09:00" in browser tz
const offset = target.getTimezoneOffset();         // 420 for MST, 360 for MDT
normalizeScheduledAt(scheduledLocal, offset);
```
Better still: pass `scheduled_at` as a fully-qualified ISO string from the picker (the function already
passes those through untouched).

### QA-4 · P2 — Mobile drawer has no dialog semantics or focus management
**Where:** `src/components/MobileNav.tsx:81`
**Evidence:** the portal drawer is a bare `div.fixed`, no `role`, no `aria-modal`, no focus trap.
`expect(drawer.getAttribute("role")).toBe("dialog")` fails (pinned). Keyboard users tab into the page
behind the drawer.
**Fix:** `role="dialog" aria-modal="true" aria-label="Navigation"`, focus the first link on open, trap
Tab, restore focus to the trigger on close (Radix `Dialog` already does all of this — reusing it is the
cheapest path).

### QA-5 · P2 — No drag-to-reschedule on the calendar
**Where:** `ContentCalendar.tsx` — zero `draggable`/`onDrop`.
**Evidence:** `[draggable='true']` count is 0 (pinned).
**Fix:** make the chip draggable and the day cell a drop target; on drop call the existing
`PATCH /api/posts/[id] { scheduled_at }` with an optimistic update and rollback on failure. The
approval gate in that route already protects status transitions.

### QA-6 · P2 — Two harness defects (not product defects, but they corrupt the signal)
1. `app-technical-audit.spec.ts` asserts dev-login 404s whenever **the test runner's**
   `ALLOW_DEV_LOGIN` is unset — but the server is started with it enabled, so the test fails
   (200 received). Pass the same env to the test process, or probe the server's advertised
   capability instead of assuming symmetry.
2. Its BOLA probe marks **any** non-2xx as `critical`; `POST /api/content-map` correctly answers
   **415** to a JSON body, so the run reports `critical: 1` for a safe response. Treat
   400/401/403/404/405/415 as "rejected" and reserve `critical` for 2xx or 5xx.

### QA-7 · P2 — Test failures print the full session cookie
Playwright's request log in `test-results/*/error-context.md` includes `cookie: sb-…-auth-token=…` —
a live super-admin session — and CI uploads `test-results/` as an artifact. Add a redaction step or
drop the artifacts for failing authed requests; rotate the session if artifacts were shared.

### QA-8 · P3 — Login inputs can be wiped before hydration
Reproduced twice: filling `#email` immediately after `domcontentloaded` resulted in an empty field
(and a blocked submit) because React re-rendered with its initial state. Also a real-world symptom on
slow connections. Fix: disable the submit button until mounted, or read the input's DOM value on
submit instead of relying on controlled state alone.

### QA-9 · P3 — Metering records spend but never gates it
The QA tenant had **no** `tenant_balances` row; two generations still ran and wrote 4 `token_ledger`
rows ($0.0009). That is the Round 20 finding confirmed behaviourally: usage is recorded, the balance
gate is open. Provision the row at registration (Round 20 P1-1) and make a missing row deny.

---

## 3. Verified working (no action)

- **Tenant deletion cascade:** after `DELETE tenants`, `workspaces`, `clients`, `posts`,
  `content_map_items`, `user_roles` all contain **0** rows for that tenant.
- **Workspace deletion** clears `clients.workspace_id` and keeps the client; **client deletion**
  clears `posts.client_id` and keeps the content (both intentional, both verified live).
- **Cross-tenant access:** a second tenant cannot list the other's clients, cannot see its posts via
  `?clientId=`, cannot see its Content Map rows, and `PATCH`/`DELETE` on a foreign post return 404
  with the target row unchanged.
- **AI guards:** unauthenticated → 401 before any work; malformed input → 400 with issue details;
  the 10/min limiter returns 429 + `Retry-After`; concurrent calls produce distinct drafts and both
  land in the caller's tenant.
- **Timezones:** `scheduled_at` round-trips as the same UTC instant through Postgres; 16:00Z renders
  as 10:00 AM in America/Denver.
- **Responsive:** 390 / 768 / 1440 px — zero horizontal overflow on Dashboard, Content Map, Posts,
  Calendar, Clients; mobile bottom nav has 4 destinations ≥44×44 px and routes correctly; drawer
  exposes 40+ links and closes on Escape.
- **Modal state:** Escape closes the calendar dialog and **restores body scroll** (no stuck scroll-lock).
- **Forms:** register shows "All fields are required." then "Password must be at least 8 characters.";
  login shows the provider error and re-enables the button; multipart endpoints answer **415**, not 500.
- **Navigation:** all 40 in-app destinations resolve <400 — no dead links.
- **Warm latencies:** Dashboard 1.17s · Posts 1.25s (was 3.2s) · Calendar 331ms (was 44s cold in
  September) · Clients 598ms · Workspaces 300ms · Content Map 304ms.

---

## 4. Suite inventory & how to run

| File | Tests | Covers |
|---|---|---|
| `tests/e2e/auth.setup.ts` | 1 | Single authenticated session (reuses storage, real UI fallback) |
| `tests/e2e/app-technical-audit.spec.ts` | 15 | Headers, auth boundary, page flows, BOLA, races (pre-existing) |
| `tests/e2e/saas-qa-integrity.spec.ts` | 12 | Cascades, RLS, cross-tenant API, timezone/DST, AI engine |
| `tests/e2e/saas-qa-ui.spec.ts` | 17 | 3 viewports, nav, drawer, calendar, modals, forms, dead links |
| `tests/e2e/qa-fixtures.ts` | — | Disposable tenant + user + rows, with a forced sweep on teardown |

```bash
# terminal 1
ALLOW_DEV_LOGIN=true NEXT_PUBLIC_DEV_LOGIN=true npx next dev --port 3100
# terminal 2
AUDIT_BASE_URL=http://localhost:3100 npx playwright test
```

The integrity suite writes only to a `QA-AUDIT-<ts>` tenant and deletes it (with a sweep) in
`afterAll`; the UI suite seeds one post in the browsing workspace and removes it by id. Both were
confirmed clean after this run: **0 QA tenants, 0 probe posts, 0 QA users** left behind.

---

## 5. Limitations of this run

- Executed against the **live Supabase project** with the platform owner's dev-login session; it is a
  functional QA run, not a load test. No production data was mutated beyond the seeded/deleted probes.
- Only one persona was exercised end-to-end (super admin). A second tenant's `agency_admin` was
  authenticated at the API level (fixture user) for isolation and AI tests, but not driven through the
  full dashboard UI.
- OAuth providers (Google/Meta/Outlook), Stripe checkout, Inngest crons and the Telegram approval flow
  were not exercised — they need external callbacks and a host, and the agency-ops tables are still
  missing (Round 20 P0-1).
- Worker recovery on a 500/429 webhook was assessed from code + unit tests, not from a live publish.
- No drag-and-drop test could run because the feature does not exist (QA-5).
