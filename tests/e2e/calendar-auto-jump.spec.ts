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
 *   4. A CLIENT-FILTERED view whose client has NO posts: a plan attributed
 *      to that client (campaign_plans.client_id = the selection) supplies
 *      the jump's month key, while other clients' current-month posts and
 *      unattributed plans do not count for the scoped view.
 *   5. OTHER CLIENTS' PROPOSED ITEMS never reach a scoped view: with ANOTHER
 *      client holding a proposed item in the CURRENT month and another in the
 *      jump month, selecting the probe client still jumps to ITS OWN month
 *      (another client's current-month proposal can't keep the view put),
 *      the OTHER client's chip stays hidden even inside the very month the
 *      view renders, and only the probe's attributed chip shows.
 *   6. The CREATOR path: a plan seeded from a sold SEO proposal via POST
 *      /api/campaign-plans/from-proposal must inherit the proposal's
 *      client_id (asserted in the DB, not staged rows), and a client-
 *      filtered calendar auto-jumps onto the seeded plan's earliest month
 *      with its topic rendered as a proposed chip.
 *
 * Case-6 history: the proposal path seeds research milestone items
 * (kind: "research"), which 046's re-tightened campaign_plan_items_kind_check
 * (blog/social/website only) rejected — every POST
 * /api/campaign-plans/from-proposal failed with "violates check constraint
 * campaign_plan_items_kind_check". Migration 115 re-admits 'research'; the
 * live DB carries it, so this case runs green.
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
  requestWithCompileRetry,
  type QaFixtures,
} from "./qa-fixtures";

const BASE = process.env.AUDIT_BASE_URL ?? "http://localhost:3100";

const FUTURE_TITLE = "QA-AUDIT auto-jump future post";
const TODAY_TITLE = "QA-AUDIT auto-jump today post";
const PLAN_TITLE = "QA-AUDIT auto-jump proposed plan";
const PROPOSED_TOPIC = "QA-AUDIT auto-jump proposed topic";
const PROPOSED_FILTERED_TOPIC = "QA-AUDIT auto-jump scoped proposed topic";
const OTHER_CURRENT_TOPIC = "QA-AUDIT auto-jump other-client current topic";
const OTHER_FUTURE_TOPIC = "QA-AUDIT auto-jump other-client future topic";
// Case 6 (creator path): the sold-proposal tier a plan is seeded from.
const PROPOSAL_TIER = "QA-AUDIT auto-jump attributed tier";
const PROPOSAL_TOPIC = "QA-AUDIT auto-jump proposal-path topic";

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

test("a client-filtered view jumps to its own proposed-only month — other clients' work stays out of the scan", async () => {
  // The scoped jump: selecting a client re-arms the auto-jump and, from then
  // on, only THAT client's posts and plans-attributed-to-it (campaign_plans.
  // client_id = the selection) may supply a month key. Here the probe client
  // has no posts at all; its ONLY future work is a proposed campaign item —
  // the jump must still fire to the proposed month, while another client's
  // current-month post (present on the disk at load) keeps the unfiltered
  // view put and must not suppress the filtered jump.
  const page = await ctx.newPage();
  const now = new Date();
  const expectedHeading = format(new Date(now.getFullYear(), now.getMonth() + 2, 1), "MMMM yyyy");
  const j = (day: number) => format(new Date(now.getFullYear(), now.getMonth() + 2, day), "yyyy-MM-dd");

  // Frozen-still precondition: sweep the tenant's posts (the suite is serial
  // and the fixture is destroyed whole in afterAll) so the only work left is
  // what this test stages.
  const swept = await todayDb.from("posts").delete().eq("tenant_id", fx.tenantId);
  expect(swept.error).toBeNull();

  // The contrast client: a post at 16:00Z TODAY (Renders as the same calendar
  // day in America/Denver, like the stay-put probe above), so the 
  // all-clients opening month is non-empty and stays put.
  const otherClient = await todayDb
    .from("clients")
    .insert({ tenant_id: fx.tenantId, workspace_id: fx.workspaceId, name: `${fx.tag} Contrast Client` })
    .select("id")
    .single<{ id: string }>();
  expect(otherClient.error).toBeNull();
  const otherClientId = otherClient.data!.id;
  const otherPost = await todayDb
    .from("posts")
    .insert({
      tenant_id: fx.tenantId,
      workspace_id: fx.workspaceId,
      client_id: otherClientId,
      title: TODAY_TITLE,
      type: "blog",
      status: "scheduled",
      scheduled_at: new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 16, 0, 0)).toISOString(),
      content: { type: "blog", title: TODAY_TITLE, body: "Auto-jump scoped counter-case." },
    })
    .select("id")
    .single<{ id: string }>();
  expect(otherPost.error).toBeNull();

  // The probe client: no posts. Its only future work is a proposed item on a
  // plan ATTRIBUTED to it — the shape scopedProposedItems keeps when the
  // client filter is set.
  const probeClient = await todayDb
    .from("clients")
    .insert({ tenant_id: fx.tenantId, workspace_id: fx.workspaceId, name: `${fx.tag} Proposed Client` })
    .select("id")
    .single<{ id: string }>();
  expect(probeClient.error).toBeNull();
  const probeClientId = probeClient.data!.id;
  const plan = await todayDb
    .from("campaign_plans")
    .insert({
      tenant_id: fx.tenantId,
      workspace_id: fx.workspaceId,
      // Attributed to the probe client: unlike the proposed-only test (whose
      // plan is cross-client by construction), this plan carries a client_id
      // so a filtered view can claim it.
      client_id: probeClientId,
      title: PLAN_TITLE,
      summary: "Auto-jump scoped proposed-only probe.",
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
      topic: PROPOSED_FILTERED_TOPIC,
      // Date-only, on the 12th of month+2 like every other probe — inside
      // the page's fetch window whatever day the run happens on.
      due_date: j(12),
      status: "proposed",
    })
    .select("id")
    .single<{ id: string }>();
  expect(item.error).toBeNull();

  try {
    await page.goto(`${BASE}/dashboard/calendar`, { waitUntil: "domcontentloaded" });

    // Load: the all-clients view holds the contrast client's current-month
    // post, so the auto-jump must not fire.
    const currentMonth = format(now, "MMMM yyyy");
    await expect(calendarHeading(page, currentMonth)).toHaveText(currentMonth, {
      timeout: 60_000,
    });

    // Scope to the probe client: this re-arms the jump (selectedClientId
    // effect) and refetches the posts list server-side — which now contains
    // ZERO posts, so the scoped scan can only find the attributed proposal.
    const clientSelect = page.locator("select").filter({ hasText: "All Clients" }).first();
    await clientSelect.selectOption(probeClientId);

    // The jump lands on the month holding the client's OWN proposal.
    await expect(calendarHeading(page, expectedHeading)).toHaveText(expectedHeading, {
      timeout: 60_000,
    });

    // And the month renders it — dashed, labeled "Proposed".
    const proposedChip = page
      .locator("button")
      .filter({ hasText: PROPOSED_FILTERED_TOPIC })
      .filter({ visible: true });
    await expect(proposedChip.first()).toBeVisible({ timeout: 60_000 });
    await expect(proposedChip.first()).toContainText("Proposed");
  } finally {
    // Sweep everything on failure too (the earlier tests re-load the
    // calendar and must not see stray rows): items then plan, post then
    // client (the FK order), each while their variables are in scope.
    if (item.data?.id) await todayDb.from("campaign_plan_items").delete().eq("plan_id", plan.data!.id);
    if (plan.data?.id) await todayDb.from("campaign_plans").delete().eq("id", plan.data!.id);
    if (otherPost.data?.id) await todayDb.from("posts").delete().eq("id", otherPost.data.id);
    if (otherClientId) await todayDb.from("clients").delete().eq("id", otherClientId);
    if (probeClientId) await todayDb.from("clients").delete().eq("id", probeClientId);
  }

  await page.close();
});

test("a client-filtered calendar hides another client's proposed chip, and the jump ignores it", async () => {
  // isolates the two sides of the scoping contract the shared proposal list
  // has to enforce on a client-filtered calendar. The contrast client owns
  // TWO proposed items: one in the CURRENT month and one in the jump month,
  // while the probe client owns only its attributed month+2 proposal.
  //   hiding: after selecting the probe client, the contrast chip staged in
  //    the SAME month the view ends up rendering must not exist anywhere in
  //    the DOM — a scoped month must not show another client's plan.
  //   ignoring: if the scan counted the contrast client's CURRENT-month
  //    proposal, monthKeys would hold the opening month and the view would
  //    stay put — the jump firing at all is the proof the other client's
  //    proposals were excluded from the scan.
  const page = await ctx.newPage();
  const now = new Date();
  // Fixed day 15: always a valid current-month date whenever the suite runs.
  const currentIsoDate = format(new Date(now.getFullYear(), now.getMonth(), 15), "yyyy-MM-dd");
  const expectedHeading = format(new Date(now.getFullYear(), now.getMonth() + 2, 1), "MMMM yyyy");
  const j = (day: number) => format(new Date(now.getFullYear(), now.getMonth() + 2, day), "yyyy-MM-dd");

  // Frozen-still precondition (serial suite): no posts on disk, so every
  // month key below comes from proposals only.
  const swept = await todayDb.from("posts").delete().eq("tenant_id", fx.tenantId);
  expect(swept.error).toBeNull();

  // The contrast client (B): its proposals must never reach the probe's
  // scoped calendar — attributed to B so only the all-clients view claims it.
  const otherClient = await todayDb
    .from("clients")
    .insert({ tenant_id: fx.tenantId, workspace_id: fx.workspaceId, name: `${fx.tag} Scoped-Out Client` })
    .select("id")
    .single<{ id: string }>();
  expect(otherClient.error).toBeNull();
  const otherClientId = otherClient.data!.id;
  const otherPlan = await todayDb
    .from("campaign_plans")
    .insert({
      tenant_id: fx.tenantId,
      workspace_id: fx.workspaceId,
      client_id: otherClientId,
      title: PLAN_TITLE,
      summary: "Auto-jump scoping counter-probe (other client).",
      status: "proposed",
      created_by: "nina",
    })
    .select("id")
    .single<{ id: string }>();
  expect(otherPlan.error).toBeNull();
  const otherItems = await todayDb
    .from("campaign_plan_items")
    .insert([
      {
        plan_id: otherPlan.data!.id,
        tenant_id: fx.tenantId,
        kind: "blog",
        topic: OTHER_CURRENT_TOPIC,
        // The CURRENT month: if the scan wrongly counted this, the opening
        // month would look non-empty for the scoped view and never jump.
        due_date: currentIsoDate,
        status: "proposed",
      },
      {
        plan_id: otherPlan.data!.id,
        tenant_id: fx.tenantId,
        kind: "blog",
        topic: OTHER_FUTURE_TOPIC,
        // The SAME month the jump lands on: if scoping failed, this chip
        // would render beside the probe's own in the filtered month.
        due_date: j(12),
        status: "proposed",
      },
    ])
    .select("id")
    .returns<{ id: string }[]>();
  expect(otherItems.error).toBeNull();
  expect(otherItems.data?.length).toBe(2);

  // The probe client (A): no posts, one ATTRIBUTED proposed item in month+2.
  const probeClient = await todayDb
    .from("clients")
    .insert({ tenant_id: fx.tenantId, workspace_id: fx.workspaceId, name: `${fx.tag} Scoped Probe Client` })
    .select("id")
    .single<{ id: string }>();
  expect(probeClient.error).toBeNull();
  const probeClientId = probeClient.data!.id;
  const plan = await todayDb
    .from("campaign_plans")
    .insert({
      tenant_id: fx.tenantId,
      workspace_id: fx.workspaceId,
      client_id: probeClientId,
      title: PLAN_TITLE,
      summary: "Auto-jump scoping probe (the attributed client).",
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
      topic: PROPOSED_FILTERED_TOPIC,
      due_date: j(12),
      status: "proposed",
    })
    .select("id")
    .single<{ id: string }>();
  expect(item.error).toBeNull();

  try {
    await page.goto(`${BASE}/dashboard/calendar`, { waitUntil: "domcontentloaded" });

    // Load: the ALL-CLIENTS view counts every plan, so the contrast client's
    // current-month proposal keeps the opening month put.
    const currentMonth = format(now, "MMMM yyyy");
    await expect(calendarHeading(page, currentMonth)).toHaveText(currentMonth, {
      timeout: 60_000,
    });
    const otherCurrentChip = page
      .locator("button")
      .filter({ hasText: OTHER_CURRENT_TOPIC })
      .filter({ visible: true });
    await expect(otherCurrentChip.first()).toBeVisible({ timeout: 60_000 });

    // Scope to the probe client: the re-armed scan may only see ITS OWN
    // attributed proposal — the contrast client's current-month item must
    // not keep the view on the opening month.
    const clientSelect = page.locator("select").filter({ hasText: "All Clients" }).first();
    await clientSelect.selectOption(probeClientId);

    await expect(calendarHeading(page, expectedHeading)).toHaveText(expectedHeading, {
      timeout: 60_000,
    });

    // The view now renders month+2 with the ATTRIBUTED proposal on it.
    const probeChip = page
      .locator("button")
      .filter({ hasText: PROPOSED_FILTERED_TOPIC })
      .filter({ visible: true });
    await expect(probeChip.first()).toBeVisible({ timeout: 60_000 });
    await expect(probeChip.first()).toContainText("Proposed");

    // And the contrast client's month+2 chip — staged for exactly the month
    // the view is now showing — must be entirely absent from the DOM.
    const leakedChip = page
      .locator("button")
      .filter({ hasText: OTHER_FUTURE_TOPIC })
      .filter({ visible: true });
    await expect(leakedChip).toHaveCount(0);
  } finally {
    // Sweep on failure too (the earlier tests re-load the calendar and must
    // not see stray rows): items then plans, then clients (FK order).
    await todayDb.from("campaign_plan_items").delete().eq("plan_id", otherPlan.data!.id);
    await todayDb.from("campaign_plan_items").delete().eq("plan_id", plan.data!.id);
    await todayDb.from("campaign_plans").delete().eq("id", otherPlan.data!.id);
    await todayDb.from("campaign_plans").delete().eq("id", plan.data!.id);
    if (otherClientId) await todayDb.from("clients").delete().eq("id", otherClientId);
    if (probeClientId) await todayDb.from("clients").delete().eq("id", probeClientId);
  }

  await page.close();
});

test("a proposal-seeded plan attributes to the proposal's client — the scoped calendar jumps to its earliest month", async () => {
  // The CREATOR path behind the service-role-staged rows above: a plan
  // seeded from a sold SEO proposal (/api/campaign-plans/from-proposal)
  // must inherit the seo_campaigns row's client_id, so the proposal's
  // items land under that client's calendar filter. The tests above write
  // campaign_plans and campaign_plan_items directly, so nothing proves the
  // write side — this test drives the real route end to end: create a
  // client, sell it a tier, POST the route, and (a) the created plan
  // carries that client_id in the DB, (b) a client-filtered calendar
  // auto-jumps onto the plan's EARLIEST proposed month and renders the
  // proposal's own topic chip there.
  const page = await ctx.newPage();
  let planId: string | null = null;
  let clientRowId: string | null = null;

  // Frozen-still precondition (serial suite): no posts on disk, so every
  // month key comes from proposals only.
  const swept = await todayDb.from("posts").delete().eq("tenant_id", fx.tenantId);
  expect(swept.error).toBeNull();

  // The attribution target — the client the proposal is sold to.
  const client = await todayDb
    .from("clients")
    .insert({ tenant_id: fx.tenantId, workspace_id: fx.workspaceId, name: `${fx.tag} Proposal Path Client` })
    .select("id")
    .single<{ id: string }>();
  expect(client.error).toBeNull();
  clientRowId = client.data!.id;

  // The sold proposal: one launch month with six blog pieces. The tier's
  // cadence (weekly) dates them from the next Monday onward — the landing
  // month is read from the DB after the route runs, never assumed.
  const proposal = await todayDb
    .from("seo_campaigns")
    .insert({
      tenant_id: fx.tenantId,
      workspace_id: fx.workspaceId,
      client_id: clientRowId!,
      url: "https://example.com",
      tier_name: PROPOSAL_TIER,
      tier_price: 1900,
      status: "proposed",
      campaign_json: {
        tierName: PROPOSAL_TIER,
        tierPrice: 1900,
        executiveSummary: "Auto-jump proposal-path probe.",
        contentCalendar: [
          {
            month: 1,
            focusArea: "Attribution",
            contentPieces: Array.from({ length: 6 }, () => ({
              type: "blog_post",
              title: PROPOSAL_TOPIC,
              targetKeyword: "attribution probe",
            })),
            technicalTasks: [],
            linkBuildingTasks: [],
          },
        ],
      },
    })
    .select("id")
    .single<{ id: string }>();
  expect(proposal.error).toBeNull();

  try {
    // First page load provisions the middleware-set x-tenant-id (and other
    // session) cookies the API routes require — a bare POST from a fresh
    // context fails on "x-tenant-id cookie is missing".
    await page.goto(`${BASE}/dashboard/calendar`, { waitUntil: "domcontentloaded" });

    // Drive the real creator route with the signed-in fixture session
    // (page.request shares the browser context's cookie jar).
    // Cold-compile hardened: this can be the run's first hit of the route.
    const resp = await requestWithCompileRetry(page.request, `${BASE}/api/campaign-plans/from-proposal`, {
      method: "POST",
      data: { campaignId: proposal.data!.id, workspaceId: fx.workspaceId },
    });
    const body = (await resp.json()) as {
      success?: boolean;
      planId?: string;
      error?: string;
    };
    expect(
      resp.ok(),
      `route failed: ${resp.status()} ${JSON.stringify(body)}`
    ).toBe(true);
    expect(body.error).toBeUndefined();
    expect(body.success).toBe(true);
    planId = body.planId ?? null;
    expect(planId).toBeTruthy();

    // (a) Write-side contract: the seeded plan is attributed to the
    // proposal's client — without this, no client filter can claim it.
    const planRow = await todayDb
      .from("campaign_plans")
      .select("client_id")
      .eq("id", planId!)
      .single<{ client_id: string | null }>();
    expect(planRow.error).toBeNull();
    expect(planRow.data!.client_id).toBe(clientRowId);

    // The expected landing month = the plan's EARLIEST proposed item month
    // (weekdays forward from today, so never in the past). If that month
    // happens to be the current one, the re-armed scan picks it too —
    // either way the view must end on exactly this month.
    const items = await todayDb
      .from("campaign_plan_items")
      .select("due_date")
      .eq("plan_id", planId!)
      .order("due_date", { ascending: true })
      .returns<{ due_date: string }[]>();
    expect(items.error).toBeNull();
    const [y, m, d] = items.data![0].due_date.split("-").map(Number);
    const expectedHeading = format(new Date(y, m - 1, 1), "MMMM yyyy");

    // (b) The scoped calendar's auto-jump: reload to a clean page state,
    // select the plan's client (re-arms the scan; possible only because of
    // the stamped client_id), and the view lands on the plan's earliest
    // month.
    await page.goto(`${BASE}/dashboard/calendar`, { waitUntil: "domcontentloaded" });
    const clientSelect = page.locator("select").filter({ hasText: "All Clients" }).first();
    await clientSelect.selectOption(clientRowId);

    await expect(calendarHeading(page, expectedHeading)).toHaveText(expectedHeading, {
      timeout: 60_000,
    });

    // The proposal's own topic renders in that month as a dashed
    // "Proposed" chip — the plan is visible through the client filter.
    const chip = page
      .locator("button")
      .filter({ hasText: PROPOSAL_TOPIC })
      .filter({ visible: true });
    await expect(chip.first()).toBeVisible({ timeout: 60_000 });
    await expect(chip.first()).toContainText("Proposed");
  } finally {
    // Sweep on failure too: proposal-seeded rows in production DB must not
    // outlive a failed run. Items cascade, but delete explicitly in FK
    // order (items → plan; the campaign and the client are independent).
    if (planId) {
      await todayDb.from("campaign_plan_items").delete().eq("plan_id", planId);
      await todayDb.from("campaign_plans").delete().eq("id", planId);
    }
    if (proposal.data?.id) {
      await todayDb.from("seo_campaigns").delete().eq("id", proposal.data.id);
    }
    if (clientRowId) await todayDb.from("clients").delete().eq("id", clientRowId);
  }

  await page.close();
});
