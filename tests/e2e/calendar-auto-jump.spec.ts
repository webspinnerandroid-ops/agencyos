/**
 * calendar-auto-jump — regression for the calendar's auto-jump effect
 * (src/components/ContentCalendar.tsx, "Auto-jump to the next non-empty month").
 *
 * The view opens on today's month and jumps forward ONCE when that opening
 * month is empty but a later month has posts. The review probe in
 * docs/DESIGN-POST-SCHEDULING-DEFAULTING.md ("No regression coverage for the
 * auto-jump ... case; the probe used during review was disposable") is turned
 * into a permanent test here, in both directions:
 *
 *   1. A fresh load whose only posts sit in month+2 → the view lands there
 *      (the operator's first glance shows planned work, not an empty grid).
 *   2. A scheduled post in the CURRENT month → no jump; the view stays put.
 *   3. NO posts at all — a single proposed campaign-plan item in month+2 →
 *      the jump merges the planned-only month from the /api/campaign-plans
 *      fetch the same way, and the dashed "Proposed" chip renders there.
 *
 * Runs against a disposable QA-AUDIT tenant (qa-fixtures) with a real signed-in
 * fixture user — no reliance on the dev session or on whatever posts happen to
 * exist in the shared dev tenant. The fixed-dated fixture cascade post is
 * deleted first: whenever the calendar is browsed while "today" is inside its
 * month (Dec 2026), it would break the "only future-month posts" invariant.
 *
 * Teardown sweeps the whole tenant (destroyFixtures), so a failed run leaves
 * no rows behind.
 */
import { test, expect, type BrowserContext } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { format } from "date-fns";
import {
  adminClient,
  createFixtures,
  destroyFixtures,
  type QaFixtures,
} from "./qa-fixtures";

const BASE = process.env.AUDIT_BASE_URL ?? "http://localhost:3100";

const FUTURE_TITLE = "QA-AUDIT auto-jump future post";
const TODAY_TITLE = "QA-AUDIT auto-jump today post";
const PLAN_TITLE = "QA-AUDIT auto-jump proposed plan";
const PROPOSED_TOPIC = "QA-AUDIT auto-jump proposed topic";

/** Same cookie the app's SSR client reads: sb-<project-ref>-auth-token. */
function sessionCookie(url: string, baseURL: string, session: unknown) {
  const ref = new URL(url).hostname.split(".")[0];
  return {
    name: `sb-${ref}-auth-token`,
    value: "base64-" + Buffer.from(JSON.stringify(session), "utf8").toString("base64url"),
    url: baseURL,
    httpOnly: false,
    sameSite: "Lax" as const,
  };
}

test.describe.configure({ mode: "serial" });

let fx: QaFixtures;
let ctx: BrowserContext;
/** Month key (yyyy-MM) the fresh calendar must land on: two months ahead. */
let futureMonthLocalDate: Date;
let todayDb: ReturnType<typeof adminClient>["db"];

test.beforeAll(async ({ browser }) => {
  const { db } = adminClient();
  todayDb = db;

  fx = await createFixtures();

  // The fixture's cascade post is hard-dated ("2026-12-15"); on a browse-day
  // between Dec 1 and Dec 15 it would land in the OPENING month and fake a
  // "stay put" for the jump test. Remove it — destroyFixtures sweeps this
  // tenant whole anyway.
  await db.from("posts").delete().eq("id", fx.postId);

  // The future probe: the 12th of month+2 at 16:00Z. In America/Denver that is
  // mid-morning on the 12th (UTC offset never reaches -16:00), so chronological
  // day == calendar day, and the page's fetch window (…through the last day of
  // month+2) always contains it.
  const now = new Date();
  const futureInstant = new Date(
    Date.UTC(now.getFullYear(), now.getMonth() + 2, 12, 16, 0, 0)
  );
  await db.from("posts").insert({
    tenant_id: fx.tenantId,
    workspace_id: fx.workspaceId,
    // Client-scoped like a real planned post (client 1 of the fixture).
    client_id: fx.clientId,
    title: FUTURE_TITLE,
    type: "blog",
    status: "scheduled",
    scheduled_at: futureInstant.toISOString(),
    content: { type: "blog", title: FUTURE_TITLE, body: "Auto-jump probe." },
  });

  // Mirror the component's own construction: it stores
  // parseISO("yyyy-MM-01T00:00:00") — a LOCAL first-of-month date — and the h2
  // formats that with "MMMM yyyy". Building the same local date here gets the
  // exact string the heading will show.
  futureMonthLocalDate = new Date(now.getFullYear(), now.getMonth() + 2, 1);

  // Sign the fixture user in for real and carry the session into the browser.
  const anon = createClient(fx.url, fx.anonKey, { auth: { persistSession: false } });
  const signedIn = await anon.auth.signInWithPassword({ email: fx.email, password: fx.password });
  if (signedIn.error || !signedIn.data.session) {
    throw new Error(`fixture sign-in failed: ${signedIn.error?.message ?? "no session"}`);
  }
  ctx = await browser.newContext({
    baseURL: BASE,
    viewport: { width: 1440, height: 900 },
    timezoneId: "America/Denver",
    // Empty state: this context uses the fixture session cookie only.
    storageState: { cookies: [], origins: [] },
  });
  await ctx.addCookies([sessionCookie(fx.url, BASE, signedIn.data.session)]);
});

test.afterAll(async () => {
  await ctx?.close();
  if (fx) await destroyFixtures(fx);
});

// The page has two level-2 headings (the month title + "Campaign plans"), so
// the month heading is matched by its exact expected text — which is also the
// regression claim being asserted.
const calendarHeading = (
  page: import("@playwright/test").Page,
  expected: string
) =>
  page
    .getByRole("heading", { level: 2 })
    .filter({ hasText: expected });

test("the calendar auto-jumps to the future month that holds its only posts", async () => {
  const page = await ctx.newPage();
  const expected = format(futureMonthLocalDate, "MMMM yyyy");

  // "Reloads the calendar": a fresh, un-navigated load of the page. No client
  // filter is selected, so the tenant's only posts are the future probe.
  await page.goto(`${BASE}/dashboard/calendar`, { waitUntil: "domcontentloaded" });

  // The jump fires when the first real posts list lands; allow a dev-compile
  // window like the rest of the qa suites.
  await expect(calendarHeading(page, expected)).toHaveText(expected, { timeout: 60_000 });

  // Landing on the month means the month actually renders the planned work —
  // the probe chip is on the grid, not merely the headline changed.
  const chip = page
    .locator("div.cursor-grab, div.cursor-pointer")
    .filter({ hasText: FUTURE_TITLE })
    .filter({ visible: true });
  await expect(chip.first()).toBeVisible({ timeout: 60_000 });

  await page.close();
});

test("a scheduled post in the current month keeps the view where it opened", async () => {
  const page = await ctx.newPage();

  // Stage the counter-case: a post at 16:00Z TODAY in the same tenant. 16:00Z
  // renders as 10:00/9:00 Mountain — always the same calendar day, so the
  // opening month is non-empty exactly when this row exists.
  const now = new Date();
  const todayInstant = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 16, 0, 0));
  const todayClient = await todayDb
    .from("clients")
    .insert({ tenant_id: fx.tenantId, workspace_id: fx.workspaceId, name: `${fx.tag} Today Client` })
    .select("id")
    .single<{ id: string }>();
  expect(todayClient.error).toBeNull();
  const todayClientId = todayClient.data!.id;
  const todayPost = await todayDb
    .from("posts")
    .insert({
      tenant_id: fx.tenantId,
      workspace_id: fx.workspaceId,
      client_id: todayClientId,
      title: TODAY_TITLE,
      type: "blog",
      status: "scheduled",
      scheduled_at: todayInstant.toISOString(),
      content: { type: "blog", title: TODAY_TITLE, body: "Auto-jump stay-put probe." },
    })
    .select("id")
    .single<{ id: string }>();
  expect(todayPost.error).toBeNull();

  try {
    await page.goto(`${BASE}/dashboard/calendar`, { waitUntil: "domcontentloaded" });

    // The opening month holds a scheduled post, so the auto-jump must NOT
    // fire — even though the future probe also exists to tempt it.
    const currentMonth = format(now, "MMMM yyyy");
    await expect(calendarHeading(page, currentMonth)).toHaveText(currentMonth, {
      timeout: 60_000,
    });
    const todayChip = page
      .locator("div.cursor-grab, div.cursor-pointer")
      .filter({ hasText: TODAY_TITLE })
      .filter({ visible: true });
    await expect(todayChip.first()).toBeVisible({ timeout: 60_000 });
  } finally {
    // Remove the counter-case (client row first is blocked by the post FK, so
    // post then client) — cleanup even on assertion failure, because the first
    // test depends on "no current-month posts".
    await todayDb.from("posts").delete().eq("id", todayPost.data!.id);
    await todayDb.from("clients").delete().eq("id", todayClientId);
  }

  await page.close();
});

test("a proposed-only future month gets the jump even with no posts behind it", async () => {
  // The doc's residual-risk case: the jump scan merges proposed months from
  // the campaign-plans fetch. Here the tenant's posts are swept EMPTY, so the
  // ONLY month key the scan can find is the plan item's — the jump must fire
  // on campaign-plan data alone.
  const page = await ctx.newPage();
  const now = new Date();
  const j = (day: number) => format(new Date(now.getFullYear(), now.getMonth() + 2, day), "yyyy-MM-dd");
  const expectedHeading = format(new Date(now.getFullYear(), now.getMonth() + 2, 1), "MMMM yyyy");

  // Clear whatever posts earlier serial tests left behind (the future probe,
  // any today rows) — the fixture is destroyed whole in afterAll anyway.
  const swept = await todayDb.from("posts").delete().eq("tenant_id", fx.tenantId);
  expect(swept.error).toBeNull();

  // A real plan + one dated proposed item, written with the service client —
  // the page then has to surface it through the live /api/campaign-plans
  // route, so the item → proposedItems plumbing is exercised end to end.
  const plan = await todayDb
    .from("campaign_plans")
    .insert({
      tenant_id: fx.tenantId,
      workspace_id: fx.workspaceId,
      // Cross-client by construction: campaign_plans.client_id is always
      // null in the codebase (design note, known limitations).
      client_id: null,
      title: PLAN_TITLE,
      summary: "Auto-jump proposed-only probe.",
      status: "proposed",
      created_by: "nina",
    })
    .select("id")
    .single<{ id: string }>();
  expect(plan.error).toBeNull();
  const item = await todayDb
    .from("campaign_plan_items")
    .insert({
      plan_id: plan.data!.id,
      tenant_id: fx.tenantId,
      kind: "blog",
      topic: PROPOSED_TOPIC,
      // Due date is date-only; the 12th of month+2 like the post probe, so
      // the fetch window (through the end of month+3) always contains it.
      due_date: j(12),
      status: "proposed",
    })
    .select("id")
    .single<{ id: string }>();
  expect(item.error).toBeNull();

  try {
    await page.goto(`${BASE}/dashboard/calendar`, { waitUntil: "domcontentloaded" });

    // The one non-empty month is planned work only — the headline must move.
    await expect(calendarHeading(page, expectedHeading)).toHaveText(expectedHeading, {
      timeout: 60_000,
    });

    // And the month renders the planned work as a dashed "Proposed" chip —
    // the landing is real, not just a headline change.
    const proposedChip = page
      .locator("button")
      .filter({ hasText: PROPOSED_TOPIC })
      .filter({ visible: true });
    await expect(proposedChip.first()).toBeVisible({ timeout: 60_000 });
    await expect(proposedChip.first()).toContainText("Proposed");
  } finally {
    // destroyFixtures doesn't sweep these tables, and a failed run must not
    // leave plan rows in the production DB. Items cascade from the plan.
    await todayDb.from("campaign_plan_items").delete().eq("plan_id", plan.data!.id);
    await todayDb.from("campaign_plans").delete().eq("id", plan.data!.id);
  }

  await page.close();
});
