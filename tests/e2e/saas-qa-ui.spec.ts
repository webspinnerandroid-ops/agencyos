/**
 * saas-qa-audit · Part 2 — UI/UX responsiveness & interaction state.
 *
 * Checklist coverage:
 *   4. Responsive viewports (390 / 768 / 1440) — overflow, navigation, targets
 *   4. Modal state management (open → Escape → closed, body scroll restored)
 *   4. Form validation error states (register, login)
 *   4. Calendar mechanics (timezone rendering, drag-to-reschedule)
 */
import { test, expect, type Page } from "@playwright/test";
import fs from "fs";
import { adminClient } from "./qa-fixtures";

/** Tenant + workspace the suite's session is actually browsing (from cookies). */
function sessionIds(): { tenantId: string | null; workspaceId: string | null } {
  try {
    const state = JSON.parse(fs.readFileSync("test-results/.audit-auth-storage.json", "utf8"));
    const cookies: Array<{ name: string; value: string }> = state.cookies ?? [];
    const tenantCookie = cookies.find((c) => c.name === "x-tenant-id")?.value ?? "";
    // Signed as `<uuid>.<hmac>` — the value is everything before the last dot.
    const tenantId = tenantCookie.includes(".") ? tenantCookie.slice(0, tenantCookie.lastIndexOf(".")) : tenantCookie;
    const workspaceId = cookies.find((c) => c.name === "workspace_id")?.value ?? null;
    return { tenantId: tenantId || null, workspaceId };
  } catch {
    return { tenantId: null, workspaceId: null };
  }
}

const BASE = process.env.AUDIT_BASE_URL ?? "http://localhost:3100";

const PAGES: Array<{ path: string; heading: RegExp }> = [
  { path: "/dashboard", heading: /dashboard|welcome|good (morning|afternoon|evening)|agency/i },
  { path: "/dashboard/content-map", heading: /content map/i },
  { path: "/dashboard/posts", heading: /posts|content/i },
  { path: "/dashboard/calendar", heading: /calendar/i },
  { path: "/dashboard/clients", heading: /clients/i },
];

function collectConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

/** True when the document is wider than its viewport (horizontal scroll). */
async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.documentElement;
    return Math.max(0, el.scrollWidth - el.clientWidth);
  });
}

/** Disposable UNDATED draft — the Unscheduled backlog strip's source row. */
async function createProbeDraft(title: string): Promise<string> {
  const { db } = adminClient();
  const { tenantId, workspaceId } = sessionIds();
  if (!tenantId) throw new Error("could not read the session tenant cookie");
  if (!workspaceId) throw new Error("the suite session has no workspace_id cookie");
  const post = await db
    .from("posts")
    .insert({
      tenant_id: tenantId,
      workspace_id: workspaceId,
      title,
      type: "blog",
      status: "draft",
      scheduled_at: null,
      content: { type: "blog", title, body: "Probe." },
    })
    .select("id")
    .single();
  if (post.error) throw new Error(`probe draft insert failed: ${post.error.message}`);
  return post.data!.id as string;
}

/** Disposable probe post in the tenant the suite session is browsing. */
async function createProbePost(title: string, scheduledIso: string): Promise<string> {
  const { db } = adminClient();
  const { tenantId, workspaceId } = sessionIds();
  if (!tenantId) throw new Error("could not read the session tenant cookie");
  if (!workspaceId) throw new Error("the suite session has no workspace_id cookie");
  const post = await db
    .from("posts")
    .insert({
      tenant_id: tenantId,
      workspace_id: workspaceId,
      title,
      type: "blog",
      status: "scheduled",
      scheduled_at: scheduledIso,
      content: { type: "blog", title, body: "Probe." },
    })
    .select("id")
    .single();
  if (post.error) throw new Error(`probe post insert failed: ${post.error.message}`);
  return post.data!.id as string;
}

async function deleteProbePost(id: string | null): Promise<void> {
  if (!id) return;
  const { db } = adminClient();
  // Child rows (publishing_logs — the cron can sweep a past-due probe
  // mid-run) block the post delete; remove them first, and surface delete
  // errors: an unchecked { error } silently leaks probe rows into the
  // tenant's calendar.
  await db.from("publishing_logs").delete().eq("post_id", id);
  const del = await db.from("posts").delete().eq("id", id);
  if (del.error) throw new Error(`probe cleanup failed for ${id}: ${del.error.message}`);
}

test.describe("saas-qa-audit · responsive viewports", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(300_000);

  for (const vp of [
    { name: "phone", width: 390, height: 844 },
    { name: "tablet", width: 768, height: 1024 },
    { name: "desktop", width: 1440, height: 900 },
  ]) {
    test(`${vp.name} ${vp.width}×${vp.height}: no horizontal overflow and headings render`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      const errors = collectConsole(page);
      const report: string[] = [];

      for (const target of PAGES) {
        const res = await page.goto(`${BASE}${target.path}`, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(800);
        const overflow = await horizontalOverflow(page);
        const headingOk = (await page.getByRole("heading").first().textContent().catch(() => "")) ?? "";
        report.push(`${target.path}: http=${res?.status()} overflow=${overflow}px heading="${headingOk.trim().slice(0, 40)}"`);
        expect(res?.status(), `${target.path} status`).toBeLessThan(400);
        expect(overflow, `${target.path} overflows horizontally by ${overflow}px`).toBeLessThanOrEqual(2);
        expect(headingOk.length, `${target.path} has no heading`).toBeGreaterThan(0);
      }

      // Hydration/console noise is reported but only *page* errors fail the run.
      const hardErrors = errors.filter((e) => e.startsWith("pageerror:"));
      expect(hardErrors, report.join("\n")).toHaveLength(0);
    });
  }

  test("phone: bottom navigation is present, tappable, and routes", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);

    const bar = page.locator('nav[aria-label="Primary"]');
    await expect(bar).toBeVisible();
    const links = bar.locator("a");
    await expect(links).toHaveCount(4); // Home / Create / Plan / Posts
    for (let i = 0; i < 4; i++) {
      const box = await links.nth(i).boundingBox();
      expect(box?.height ?? 0, `bottom nav item ${i} is shorter than 44px`).toBeGreaterThanOrEqual(44);
      expect(box?.width ?? 0, `bottom nav item ${i} is narrower than 44px`).toBeGreaterThanOrEqual(44);
    }
    await bar.getByRole("link", { name: /^posts$/i }).click();
    await page.waitForURL(/\/dashboard\/posts/, { timeout: 45_000 });
  });

  test("phone: More opens the grouped drawer with every section reachable", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
    const bar = page.locator('nav[aria-label="Primary"]');
    // The "More" slot renders MobileNav's trigger (accessible name
    // "Toggle navigation menu") next to a plain "More" <span>.
    const moreButton = bar.getByRole("button").last();
    await expect(moreButton).toBeVisible();
    await moreButton.click();
    // The drawer is a plain fixed <div> (no role/aria-modal — see the pin below).
    const drawer = page.locator("div.fixed.inset-y-0.right-0").last();
    await expect(drawer).toBeVisible({ timeout: 15_000 });
    const drawerLinks = await drawer.locator("a").count();
    expect(drawerLinks, "drawer exposes no navigation links").toBeGreaterThan(10);
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden({ timeout: 10_000 });
  });

  test("the mobile drawer is a modal dialog with contained focus", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
    const trigger = page.locator('nav[aria-label="Primary"]').getByRole("button").last();
    await trigger.click();

    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible({ timeout: 15_000 });
    await expect(drawer).toHaveAttribute("aria-modal", "true");
    await expect(drawer).toHaveAccessibleName(/menu/i);

    // Focus starts inside, and Tab never escapes the panel.
    const focusInside = async () =>
      page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"]');
        return !!dialog && dialog.contains(document.activeElement);
      });
    expect(await focusInside(), "focus did not move into the drawer").toBe(true);
    for (let i = 0; i < 30; i++) await page.keyboard.press("Tab");
    expect(await focusInside(), "Tab escaped the drawer").toBe(true);

    // Escape closes it and focus returns to the trigger.
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden({ timeout: 10_000 });
    expect(await trigger.evaluate((el) => el === document.activeElement)).toBe(true);
  });
});

test.describe("saas-qa-audit · calendar mechanics", () => {
  test.use({ timezoneId: "America/Denver" });

  let probePostId: string | null = null;
  let probeTenantId: string | null = null;

  test.beforeAll(async () => {
    const { db } = adminClient();
    // Resolve the tenant + workspace the suite's session is browsing (from its
    // own cookies) — a super_admin can belong to several tenants, so picking
    // the first user_roles row is not necessarily the active one.
    const { tenantId, workspaceId } = sessionIds();
    if (!tenantId) throw new Error("could not read the session tenant cookie");
    if (!workspaceId) throw new Error("the suite session has no workspace_id cookie — the calendar binds it");
    probeTenantId = tenantId;
    const ws = { data: workspaceId ? { id: workspaceId } : null };

    // Leak recovery: a run killed mid-test never reached its own finally, so
    // its QA-AUDIT probes leaked into this tenant. Stale rows collide with
    // today's probe titles — a `.first()` locator then resolves a dead probe
    // (its PATCHes bypass the test's route probe, a dialog opens the wrong
    // post). Purge the probe-prefix titles before staging anything new.
    const stale = await db
      .from("posts")
      .select("id")
      .eq("tenant_id", tenantId)
      .like("title", "QA-AUDIT%");
    for (const row of stale.data ?? []) {
      await db.from("publishing_logs").delete().eq("post_id", row.id);
      await db.from("posts").delete().eq("id", row.id);
    }

    const at = new Date();
    at.setUTCHours(16, 0, 0, 0); // 16:00Z = 10:00 MDT in October
    const post = await db
      .from("posts")
      .insert({
        tenant_id: probeTenantId,
        workspace_id: ws.data?.id ?? null,
        title: "QA-AUDIT modal probe",
        type: "blog",
        status: "scheduled",
        scheduled_at: at.toISOString(),
        content: { type: "blog", title: "QA-AUDIT modal probe", body: "Probe." },
      })
      .select("id")
      .single();
    if (post.error) throw new Error(`probe post insert failed: ${post.error.message}`);
    probePostId = post.data.id;
  });

  test.afterAll(async () => {
    if (!probePostId) return;
    const { db } = adminClient();
    await db.from("posts").delete().eq("id", probePostId);
  });

  // Post chip on the active calendar view. The chip's class list goes
  // through twMerge (cn()), so the drag refactor's conditional `cursor-grab`
  // conflicts with and evicts `cursor-pointer` — scheduled chips render as
  // cursor-grab only. Match either cursor class, and keep the result VISIBLE:
  // stale failed runs hid a version of this page that rendered both views'
  // markup with the inactive one display:none, which made `.first()` a
  // hidden chip forever. Match out the display:none duplicates too.
  const chip = (page: Page) =>
    page
      .locator("div.cursor-grab, div.cursor-pointer")
      .filter({ visible: true })
      .first();

  test("calendar renders the month and opens a post dialog in agency-local time", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${BASE}/dashboard/calendar`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 2 }).first()).toBeVisible({ timeout: 60_000 });
    await expect(chip(page)).toBeVisible({ timeout: 60_000 });
    await chip(page).click();

    const dialog = page.getByRole("dialog").last();
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    await expect(dialog).toContainText(/post detail/i);
    // 16:00Z must render as 10:00 AM in America/Denver (UTC-6 in October).
    await expect(dialog).toContainText(/10:00\s*AM/i);
    // The dialog's body is a separate defect (see the pin below).
  });

  test("the post dialog hydrates the body and identifies the post", async ({ page }) => {
    // The list API returns only the small keys; the body arrives from
    // GET /api/posts/[id] when the dialog opens.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${BASE}/dashboard/calendar`, { waitUntil: "domcontentloaded" });
    // Scoped to the probe title: "first chip in DOM" depends on which other
    // posts exist in the tenant on that day.
    const probeChip = page
      .locator("div.cursor-grab, div.cursor-pointer")
      .filter({ hasText: "QA-AUDIT modal probe" })
      .first();
    await expect(probeChip).toBeVisible({ timeout: 60_000 });
    await probeChip.click();
    const dialog = page.getByRole("dialog").last();
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    await expect(dialog).toContainText(/QA-AUDIT modal probe/i, { timeout: 20_000 });
  });

  test("dialog state: Escape closes it and restores body scroll", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${BASE}/dashboard/calendar`, { waitUntil: "domcontentloaded" });
    await expect(chip(page)).toBeVisible({ timeout: 60_000 });
    await chip(page).click();
    const dialog = page.getByRole("dialog").last();
    await expect(dialog).toBeVisible({ timeout: 20_000 });

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden({ timeout: 10_000 });
    const locked = await page.evaluate(() => {
      const style = window.getComputedStyle(document.body);
      return style.overflow === "hidden" || style.pointerEvents === "none";
    });
    expect(locked, "body is still scroll-locked after the dialog closed").toBe(false);
  });

  test("the month grid exposes drag-to-reschedule (pin retired when the affordance shipped)", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${BASE}/dashboard/calendar`, { waitUntil: "domcontentloaded" });
    await expect(chip(page)).toBeVisible({ timeout: 60_000 });
    // The old pin (“no drag affordance”) inverted once drag-to-reschedule
    // shipped: scheduled chips are draggable and the grid is droppable.
    const draggables = await page.locator("[draggable='true']").count();
    expect(draggables, "scheduled chips are not draggable on the month grid").toBeGreaterThan(0);
  });

  test("phone: calendar does not overflow horizontally", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/dashboard/calendar`, { waitUntil: "domcontentloaded" });
    await expect(chip(page)).toBeVisible({ timeout: 60_000 });
    const overflow = await horizontalOverflow(page);
    expect(overflow, `calendar overflows by ${overflow}px on a 390px viewport`).toBeLessThanOrEqual(2);
  });

  test("phone: drag-and-drop affordance is the same week strip and month grid", async ({ page }) => {
    // 16:00Z is 10:00 America/Denver — always today's local calendar date,
    // so the probe chip sits inside the week strip's default (current) week.
    const at = new Date();
    at.setUTCHours(16, 0, 0, 0);
    const probeId = await createProbePost("QA-AUDIT phone drag probe", at.toISOString());
    try {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${BASE}/dashboard/calendar`, { waitUntil: "domcontentloaded" });

      const probeChip = page
        .locator("div.bg-card", { hasText: "QA-AUDIT phone drag probe" })
        .filter({ visible: true })
        .first();
      const draggables = () => page.locator("div[draggable='true']").filter({ visible: true });
      const dropTargets = () => page.locator("[data-drop-day]").filter({ visible: true });

      // Phones open on the week strip: draggable chips over one drop row
      // per day, wired with the same [data-drop-day] targets as the grid.
      await expect(probeChip).toBeVisible({ timeout: 60_000 });
      expect(
        await draggables().count(),
        "the week strip does not expose draggable chips"
      ).toBeGreaterThan(0);
      expect(
        await dropTargets().count(),
        "the week strip does not expose day drop targets"
      ).toBe(7);

      // Switching to the month grid must keep the SAME affordance: the same
      // draggable chips over the same [data-drop-day] targets, page still
      // fitting the viewport (drag targets must be reachable, not off-screen).
      await page
        .getByRole("group", { name: "Calendar view" })
        .getByRole("button", { name: "Month" })
        .click();
      await expect(probeChip).toBeVisible({ timeout: 30_000 });
      expect(
        await draggables().count(),
        "the month grid does not expose draggable chips"
      ).toBeGreaterThan(0);
      expect(
        await dropTargets().count(),
        "the month grid does not expose day drop targets"
      ).toBeGreaterThanOrEqual(35);
      const overflow = await horizontalOverflow(page);
      expect(
        overflow,
        `the month grid overflows by ${overflow}px on a 390px viewport`
      ).toBeLessThanOrEqual(2);
    } finally {
      await deleteProbePost(probeId);
    }
  });

  test("desktop week strip: HTML5 dragTo reschedules to the adjacent day", async ({ page }) => {
    // 16:00Z is 10:00 America/Denver on MDT days — always inside the week the
    // strip opens on, so the probe renders without navigating weeks.
    const at = new Date();
    at.setUTCHours(16, 0, 0, 0);
    const probeId = await createProbePost("QA-AUDIT week drag probe", at.toISOString());
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`${BASE}/dashboard/calendar`, { waitUntil: "domcontentloaded" });

      // Week-strip cells carry the full Denver-local date on [data-drop-day]
      // (the month-grid helpers match on `min-h-[110px]` cells the strip does
      // not use).
      const weekCell = (dateKey: string) => page.locator(`[data-drop-day="${dateKey}"]`);
      const chipInWeek = (dateKey: string) =>
        weekCell(dateKey).locator("div.bg-card", { hasText: "QA-AUDIT week drag probe" }).first();

      // Denver-local date keys (the browser renders America/Denver; the spec
      // process may not).
      const todayKey = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit",
      }).format(new Date());
      const utcOfKey = (k: string) => {
        const [y, mo, d] = k.split("-").map(Number);
        return Date.UTC(y, mo - 1, d);
      };
      const dow = new Date(utcOfKey(todayKey)).getUTCDay();
      // Stay inside the rendered 7-day strip: Sun–Fri drop on the next day,
      // Saturday on the previous one.
      const targetKey = new Date(
        utcOfKey(todayKey) + (dow === 6 ? -86_400_000 : +86_400_000)
      ).toISOString().slice(0, 10);

      // Wait for hydration + posts before toggling: a click on a page whose
      // React handlers are not attached is a silent no-op.
      const firstChip = page
        .locator("div.bg-card", { hasText: "QA-AUDIT week drag probe" })
        .filter({ visible: true })
        .first();
      await expect(firstChip).toBeVisible({ timeout: 90_000 });

      // Switch into the week strip and VERIFY it took: week rows carry a
      // `w-12` label column the month grid never renders. Re-click until the
      // strip owns the DOM.
      await expect
        .poll(
          async () => {
            const onWeek =
              (await page.locator(`[data-drop-day="${todayKey}"] div.w-12`).count()) > 0;
            if (!onWeek) {
              await page
                .getByRole("group", { name: "Calendar view" })
                .getByRole("button", { name: "Week" })
                .click()
                .catch(() => undefined);
            }
            return onWeek;
          },
          { timeout: 30_000, intervals: [1_000], message: "the calendar never switched to the week strip" },
        )
        .toBe(true);

      await expect(chipInWeek(todayKey)).toBeVisible({ timeout: 90_000 });

      const pageErrors: string[] = [];
      page.on("pageerror", (err) => pageErrors.push(err.message));

      const patchBodies: string[] = [];
      await page.route(`**/api/posts/${probeId}`, async (route) => {
        if (route.request().method() === "PATCH") {
          patchBodies.push(
            ((route.request().postDataJSON() as { scheduled_at?: string }) ?? {}).scheduled_at ?? ""
          );
        }
        await route.continue();
      });

      // Same swallowed-gesture retry as the month-grid drags: re-attempt the
      // gesture until the chip verifiably lands on the target row.
      await expect
        .poll(
          async () => {
            if ((await chipInWeek(targetKey).count()) > 0) return true;
            const current = page
              .locator("div.bg-card", { hasText: "QA-AUDIT week drag probe" })
              .filter({ visible: true })
              .first();
            if ((await current.count()) === 0) return false;
            try {
              await current.dragTo(weekCell(targetKey), { timeout: 10_000 });
            } catch {
              // The gesture never started; the poll re-runs.
            }
            return (await chipInWeek(targetKey).count()) > 0;
          },
          { timeout: 30_000, intervals: [500], message: `the week-strip drop never landed on ${targetKey}` },
        )
        .toBe(true);

      // Mirror of ContentCalendar.rescheduleToDay: the chip keeps the wall
      // hours it renders locally and is rebased onto the target date with the
      // offset in force THERE. Read both through Intl — the spec process is
      // not forced to Denver. (The target day's offset is the one 10:00 wall
      // sees on every adjacent pair; Denver's switches at 02:00 local.)
      const probeParts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "America/Denver", hourCycle: "h23", hour: "2-digit", minute: "2-digit",
      }).formatToParts(at);
      const wallH = Number(probeParts.find((p) => p.type === "hour")!.value);
      const wallM = Number(probeParts.find((p) => p.type === "minute")!.value);
      const [ty, tm, td] = targetKey.split("-").map(Number);
      const targetOffName = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Denver", timeZoneName: "shortOffset",
      })
        .formatToParts(new Date(Date.UTC(ty, tm - 1, td, 12, 0)))
        .find((p) => p.type === "timeZoneName")?.value;
      const offMatch = /GMT([+-]?\d{1,2})/.exec(targetOffName ?? "");
      expect(offMatch, `unparsable zone name ${targetOffName}`).not.toBeNull();
      // normalizeScheduledAt: utcMs = Date.UTC(wall) + getTimezoneOffset*60k;
      // getTimezoneOffset is (UTC − wall), opposite the GMT name's sign.
      const expected = new Date(
        Date.UTC(ty, tm - 1, td, wallH, wallM) - Number(offMatch![1]) * 3_600_000
      ).toISOString();

      await expect.poll(() => patchBodies.length).toBeGreaterThan(0);
      expect(new Date(patchBodies[0]).toISOString()).toBe(expected);
      // The chip itself lands on the target row.
      await expect(chipInWeek(targetKey)).toBeVisible();
      expect(pageErrors, `page errors during drag:\n${pageErrors.join("\n")}`).toEqual([]);
    } finally {
      await deleteProbePost(probeId);
    }
  });

  test("post chips on the month grid identify their post", async ({ page }) => {
    // /api/posts re-shapes rows into `post.content`, so the chip excerpt has a
    // title to render instead of falling back to "No content".
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${BASE}/dashboard/calendar`, { waitUntil: "domcontentloaded" });
    // Scoped to the probe title: "first chip in DOM" depends on which other
    // posts exist in the tenant on that day.
    const probeChip = page
      .locator("div.cursor-grab, div.cursor-pointer")
      .filter({ hasText: "QA-AUDIT modal probe" })
      .first();
    await expect(probeChip).toBeVisible({ timeout: 60_000 });
    expect(await probeChip.innerText()).toContain("QA-AUDIT modal probe");
  });

  // ---- Drag-to-reschedule QA (DST, undo, double-drop) ----

  // The drop-cell and chip locators. Cells carry the day number in a direct
  // child span; chips are the bg-card divs (one exceerpt + status pill).
  // `at` picks the match when the same day number appears twice in October's
  // view (e.g. Oct 2 mid-month vs the Nov 2 tail cell): the tail cell sits
  // later in DOM order.
  const cellByDay = (
    page: Page,
    day: string,
    at: "first" | "last" = "first"
  ) =>
    page
      .locator("div[class*='min-h-[110px]']")
      .filter({ has: page.locator(`span:text-is("${day}")`) })
      .locator(at === "first" ? "nth=0" : "nth=-1");
  const chipIn = (
    page: Page,
    day: string,
    title: string,
    at: "first" | "last" = "first"
  ) => cellByDay(page, day, at).locator("div.bg-card", { hasText: title }).first();

  // HTML5 dragstart events are intermittently swallowed by Chromium when
  // gestures run back-to-back in CI: one missed dragstart leaves the chip
  // unmoved and every later assertion times out. Retry the gesture from the
  // chip's CURRENT position until it verifiably lands on the target day; a
  // swallowed attempt is a strict no-op, so retries cannot overshoot and the
  // final state is exactly one clean drop. (Callers that assert a drop is a
  // NO-OP keep their plain .dragTo — a retried gesture there proves nothing.)
  const dropOnDay = async (
    pageRef: Page,
    title: string,
    toDay: string,
    // Match-sides selector for `toDay`: a dropped chip can share its day
    // number with an earlier cell (a trailing next-month cell repeats 1–6),
    // so callers pin which cell's DOM occurrence is the target.
    at: "first" | "last" = "first"
  ) => {
    const landed = chipIn(pageRef, toDay, title, at);
    await expect
      .poll(
        async () => {
          if ((await landed.count()) > 0) return true;
          const current = pageRef
            .locator("div.bg-card", { hasText: title })
            .filter({ visible: true })
            .first();
          if ((await current.count()) === 0) return false;
          try {
            await current.dragTo(cellByDay(pageRef, toDay, at).locator("span").first(), {
              timeout: 10_000,
            });
          } catch {
            // The gesture never started; the poll re-runs from wherever the chip now is.
          }
          return (await landed.count()) > 0;
        },
        { timeout: 30_000, intervals: [500], message: `drop of "${title}" never landed on day ${toDay}` },
      )
      .toBe(true);
  };

  // The three drag scenarios run inside a nested describe set to
  // Europe/Berlin, so the DST boundary falls INSIDE the rendered month view:
  // Berlin's fall-back is Sunday Oct 25, 2026 — Oct 24 is CEST (UTC+2),
  // Oct 26 is CET (UTC+1), and both days sit on the same visible week row.
  // An Oct 31 → Nov 2 drag (America/Denver) is impossible to stage here
  // because the month grid renders no trailing adjacent-month days.
  //
  // The wall clock is 10:00 local on both dates. Correct behavior — the
  // offset resolved for the TARGET date — stores 08:00Z for the Oct 24 drop.
  // The regression this guards (using "today's" offset instead: Oct 26 is
  // CET, so −60) would store 09:00Z — a silent one-hour wall-clock drift.
  //
  // These three run in the CURRENT Europe/Berlin month whenever that month
  // contains a DST transition (last Sunday of October or of March): a probe
  // sits just after the boundary, and the spec expresses both instants and
  // day cells through the computed boundary — month view and expectations
  // then follow automatically, whatever the CI date is.
  const BERLIN_OFF_HRS = (iso: string): number => {
    // Deterministic across host TZs: read Berlin's "GMT+2"-style zone name
    // for that instant out of Intl (Node ≥ full-ICU and Chromium both ship it).
    const name = new Intl.DateTimeFormat("en-US", {
      timeZone: "Europe/Berlin",
      timeZoneName: "shortOffset",
    })
      .formatToParts(new Date(iso))
      .find((p) => p.type === "timeZoneName")?.value;
    const match = /GMT([+-]\d{1,2})/.exec(name ?? "");
    return match ? Number(match[1]) : 0;
  };

  test.describe("drag mechanics at a DST boundary inside the view", () => {
    test.describe.configure({ mode: "serial" });
    test.use({ timezoneId: "Europe/Berlin" });

    const now = new Date();
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    // UTC month m contains a Berlin DST transition in exactly these months:
    //   March: last Sunday, 02:00 CET (UTC+1) → 03:00 CEST (UTC+2)
    //   October: last Sunday, 03:00 CEST (UTC+2) → 02:00 CET (UTC+1)
    // The transition happens at 01:00 UTC on that Sunday in both cases.
    const TRANSITION_MONTHS = [2, 9];
    const DST_WINDOW = TRANSITION_MONTHS.includes(m);

    // Last Sunday of the current month (UTC). Berlin's offset changes at
    // 01:00 UTC on that day, so 09:00 UTC on it is unambiguously past the
    // switch — a probe there uses the month's NEW offset. The PROBE stays on
    // that Sunday itself (never the day after): when the last Sunday is the
    // month's final day (e.g. Oct 2027), the following date would fall into
    // the next month, outside the rendered grid.
    const lastSunday = new Date(
      Date.UTC(y, m + 1, 0) - (new Date(Date.UTC(y, m + 1, 0)).getUTCDay() * 86_400_000)
    );
    // Target day: the Saturday just before the boundary — the OLD offset —
    // and always inside the open month view.
    const beforeDay = new Date(lastSunday.getTime() - 86_400_000);
    const dayNo = (d: Date) => String(d.getUTCDate());
    const probeDayNo = dayNo(lastSunday);
    const targetDay = dayNo(beforeDay);
    const probeInstant = new Date(lastSunday.getTime() + 9 * 3_600_000); // 09:00Z on the boundary Sunday
    // Preserving the wall clock while the target day sits on a different
    // offset: the clock reading stays 10:00-local, rebased onto the TARGET
    // civil date and resolved with the TARGET date's offset:
    //   target epoch = target civil midnight (UTC) + local wall ms since
    //   midnight (probe instant + its offset) - target offset.
    const wallPreservedEpoch = (): Date => {
      const probeOff = BERLIN_OFF_HRS(probeInstant.toISOString());
      const targetOff = BERLIN_OFF_HRS(new Date(beforeDay.getTime() + 12 * 3_600_000).toISOString());
      const wallMsOfProbe =
        (probeInstant.getTime() + probeOff * 3_600_000) % 86_400_000;
      return new Date(
        Date.UTC(y, m, beforeDay.getUTCDate()) + wallMsOfProbe - targetOff * 3_600_000
      );
    };

    test("drag across the DST boundary keeps the same local wall time", async ({ page }) => {
      test.skip(!DST_WINDOW, "the view's month has no Berlin DST transition to drag across");
      test.setTimeout(240_000);
      const probeId = await createProbePost("QA-AUDIT DST probe", probeInstant.toISOString());
      const expectedInstant = wallPreservedEpoch().toISOString();
      try {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto(`${BASE}/dashboard/calendar`, { waitUntil: "domcontentloaded" });
        const chip = chipIn(page, probeDayNo, "QA-AUDIT DST probe");
        await expect(chip).toBeVisible({ timeout: 90_000 });

        const pageErrors: string[] = [];
        page.on("pageerror", (err) => pageErrors.push(err.message));

        const patchBodies: string[] = [];
        await page.route(`**/api/posts/${probeId}`, async (route) => {
          const req = route.request();
          if (req.method() === "PATCH") {
            const body = (req.postDataJSON() as { scheduled_at?: string }) ?? {};
            patchBodies.push(body.scheduled_at ?? "");
          }
          await route.continue();
        });

        await dropOnDay(page, "QA-AUDIT DST probe", targetDay);

        await expect.poll(() => patchBodies.length).toBeGreaterThan(0);
        expect(new Date(patchBodies[0]).toISOString()).toBe(expectedInstant);
        // The chip itself lands on the target day.
        await expect(chipIn(page, targetDay, "QA-AUDIT DST probe")).toBeVisible();
        // A dropped drop must not crash the page.
        expect(pageErrors, `page errors during drag:\n${pageErrors.join("\n")}`).toEqual([]);
      } finally {
        await deleteProbePost(probeId);
      }
    });

    test("drag to the wrong day offers Undo, which restores the previous exact instant", async ({ page }) => {
      test.skip(!DST_WINDOW, "the view's month has no Berlin DST transition to drag across");
      test.setTimeout(240_000);
      const probeId = await createProbePost("QA-AUDIT Undo probe", probeInstant.toISOString());
      const probeRestoredIso = probeInstant.toISOString();
      try {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto(`${BASE}/dashboard/calendar`, { waitUntil: "domcontentloaded" });
        const chip = chipIn(page, probeDayNo, "QA-AUDIT Undo probe");
        await expect(chip).toBeVisible({ timeout: 90_000 });

        const patchBodies: string[] = [];
        await page.route(`**/api/posts/${probeId}`, async (route) => {
          const req = route.request();
          if (req.method() === "PATCH") {
            patchBodies.push(
              ((req.postDataJSON() as { scheduled_at?: string }) ?? {}).scheduled_at ?? ""
            );
            // Hold the response briefly so the chip visibly moves optimistically
            // before the banner appears (the banner is success-gated).
            await new Promise((r) => setTimeout(r, 1_200));
          }
          await route.continue();
        });

        await dropOnDay(page, "QA-AUDIT Undo probe", targetDay);

        const banner = page.getByTestId("post-move-undo");
        await expect(banner).toBeVisible({ timeout: 20_000 });
        await expect(banner).toContainText("QA-AUDIT Undo probe");
        // The banner spells the target day the browser-rendered way
        // (month: "short", day: "numeric"): "Oct 24"-shaped (October) or
        // "Mar 28"-shaped (March). Match like with like.
        const bannerMonth = new Date(beforeDay.getTime() + 12 * 3_600_000)
          .toLocaleDateString("en-US", { month: "short", timeZone: "Europe/Berlin" });
        await expect(banner).toContainText(new RegExp(`${bannerMonth}\\s*${targetDay}`));

        await banner.getByRole("button", { name: /undo/i }).click();
        // The undo is itself a move: second PATCH carries the exact instant the
        // row had before the drop — restored verbatim, no offset recomputation.
        await expect.poll(() => patchBodies.length).toBe(2);
        expect(new Date(patchBodies[1]).toISOString()).toBe(probeRestoredIso);
        await expect(chipIn(page, probeDayNo, "QA-AUDIT Undo probe")).toBeVisible();
        await expect(banner).toBeHidden();
      } finally {
        await deleteProbePost(probeId);
      }
    });

    test("double drop: the reverse re-drop waits for the in-flight PATCH, then applies exactly (last drop wins)", async ({ page }) => {
      test.skip(!DST_WINDOW, "the view's month has no Berlin DST transition to drag across");
      test.setTimeout(240_000);
      const probeId = await createProbePost("QA-AUDIT double-drop probe", probeInstant.toISOString());
      const probeRestoredIso = probeInstant.toISOString();
      const expectedInstant = wallPreservedEpoch().toISOString();
      try {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto(`${BASE}/dashboard/calendar`, { waitUntil: "domcontentloaded" });
        const chip = chipIn(page, probeDayNo, "QA-AUDIT double-drop probe");
        await expect(chip).toBeVisible({ timeout: 90_000 });

        const patchBodies: string[] = [];
        let releaseFirst!: () => void;
        const firstHeld = new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
        await page.route(`**/api/posts/${probeId}`, async (route) => {
          const req = route.request();
          if (req.method() !== "PATCH") return route.continue();
          patchBodies.push(
            ((req.postDataJSON() as { scheduled_at?: string }) ?? {}).scheduled_at ?? ""
          );
          if (patchBodies.length === 1) {
            await firstHeld; // keep the first PATCH in flight while the test acts
            await new Promise((r) => setTimeout(r, 400));
          }
          await route.continue();
        });

        // Drop 1: chip day → boundary Saturday, response held by the gate.
        await dropOnDay(page, "QA-AUDIT double-drop probe", targetDay);
        await expect.poll(() => patchBodies.length).toBe(1);

      // The reverse move is dropped while drop 1 is still in flight. Its PATCH
      // must NOT be sent until the first completes (per-post serialization) —
      // otherwise the slower first write could land last and strand the row at
      // the earlier instant while the UI shows the later day.
      await dropOnDay(page, "QA-AUDIT double-drop probe", probeDayNo);

      await page.waitForTimeout(700);
      expect(
        patchBodies.length,
        "the reverse move's PATCH was sent while the first was still in flight"
      ).toBe(1);

      releaseFirst();
      await expect.poll(() => patchBodies.length).toBe(2);
      // Serialized in drop order; the final write is the reverse move's exact
      // value, and the chip ends where the user last dropped it.
      expect(new Date(patchBodies[0]).toISOString()).toBe(expectedInstant);
      expect(new Date(patchBodies[1]).toISOString()).toBe(probeRestoredIso);
      await expect(chipIn(page, probeDayNo, "QA-AUDIT double-drop probe")).toBeVisible();

      // A drop on the post's own day is a no-op: no third PATCH.
      await chipIn(page, probeDayNo, "QA-AUDIT double-drop probe")
        .dragTo(cellByDay(page, probeDayNo).locator("span").first());
      await page.waitForTimeout(500);
      expect(patchBodies.length, "same-day drop fired a reschedule").toBe(2);
      } finally {
        await deleteProbePost(probeId);
      }
    });
  });

  test.describe("drag across the week-row boundary at a month-length edge", () => {
    // Pinned so the geometry and the expected instants are identical on any
    // host/CI machine (the calendar renders in the browser's zone).
    test.use({ timezoneId: "America/Denver" });

    const now = new Date();
    // The staged VIEW is the calendar's next month — one click on the header
    // arrow. Its last week row spills into the following month whenever the
    // month does not END on a Saturday (those weeks fit inside the month, so
    // there is no row whose Saturday/Sunday pair sits on either side of the
    // month-length edge).
    const stageFirst = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 12));
    const stageLast = new Date(
      Date.UTC(stageFirst.getUTCFullYear(), stageFirst.getUTCMonth() + 1, 0)
    );
    const STRADDLES = stageLast.getUTCDay() !== 6;
    // Source: the Saturday BEFORE the final week row (previous row's last
    // cell). Target: the first spilled day — the 1st of the next month, in
    // the final row. Dropping crosses BOTH the week-row boundary and the
    // month-length edge (the naive-arithmetic edge where a 30/31-day month
    // hands the day arithmetic to the next month).
    const rowStart = new Date(stageLast.getTime() - stageLast.getUTCDay() * 86_400_000);
    const sourceDate = new Date(rowStart.getTime() - 86_400_000);
    const targetDate = new Date(stageLast.getTime() + 86_400_000);
    const dayKey = (d: Date) => d.toISOString().slice(0, 10);
    const dayNo = (d: Date) => String(d.getUTCDate());
    const DENVER = "America/Denver";
    const caption = (firstOfMonth: Date) =>
      new Intl.DateTimeFormat("en-US", {
        month: "long", year: "numeric", timeZone: DENVER,
      }).format(firstOfMonth);
    const denverOffHrs = (iso: string): number => {
      const name = new Intl.DateTimeFormat("en-US", {
        timeZone: DENVER, timeZoneName: "shortOffset",
      })
        .formatToParts(new Date(iso))
        .find((p) => p.type === "timeZoneName")?.value;
      const match = /GMT([+-]?\d{1,2})/.exec(name ?? "");
      return match ? Number(match[1]) : 0;
    };

    test("cross-row drag across the month edge: write is serialized in drop order and lands wall-preserved", async ({ page }) => {
      test.skip(
        !STRADDLES,
        `${caption(stageFirst)} ends on a Saturday — its final week row has no spill into the next month`
      );
      test.setTimeout(240_000);
      const title = "QA-AUDIT month-edge probe";
      const probeIso = `${dayKey(sourceDate)}T16:00:00.000Z`;
      const probeInstant = new Date(probeIso).toISOString();
      const probeId = await createProbePost(title, probeInstant);
      try {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto(`${BASE}/dashboard/calendar`, { waitUntil: "domcontentloaded" });

        // Move to the staged month: a click before hydration is a silent
        // no-op, so click the arrow again until the caption verifiably changed
        // (same retry shape as the week-strip toggle above).
        const stageCaption = caption(stageFirst);
        await expect
          .poll(
            async () => {
              if ((await page.locator("h2", { hasText: stageCaption }).count()) > 0) return true;
              const h2 = page.locator("h2", { hasText: caption(now) }).first();
              if ((await h2.count()) === 0) return false;
              await h2.locator("xpath=following-sibling::button[1]").click().catch(() => undefined);
              return (await page.locator("h2", { hasText: stageCaption }).count()) > 0;
            },
            { timeout: 60_000, intervals: [1_000], message: `the calendar never showed ${stageCaption}` },
          )
          .toBe(true);

        const sourceChip = chipIn(page, dayNo(sourceDate), title, "first");
        await expect(sourceChip).toBeVisible({ timeout: 90_000 });

        const pageErrors: string[] = [];
        page.on("pageerror", (err) => pageErrors.push(err.message));

        // Hold the FIRST reschedule PATCH in flight so the reverse re-drop
        // below is issued while the earlier write is still queued — the exact
        // race the per-post serialization queue exists for.
        const patchBodies: string[] = [];
        let releaseFirst!: () => void;
        const firstHeld = new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
        await page.route(`**/api/posts/${probeId}`, async (route) => {
          const req = route.request();
          if (req.method() !== "PATCH") return route.continue();
          patchBodies.push(
            ((req.postDataJSON() as { scheduled_at?: string }) ?? {}).scheduled_at ?? ""
          );
          if (patchBodies.length === 1) {
            await firstHeld;
            await new Promise((r) => setTimeout(r, 400));
          }
          await route.continue();
        });

        // Drop 1: across the week boundary AND the month edge. "last" pins
        // the trailing next-month cell (its day number repeats day 1 of the
        // staged month earlier in the grid).
        await dropOnDay(page, title, dayNo(targetDate), "last");
        await expect.poll(() => patchBodies.length).toBe(1);

        // Drop 2: the reverse move, dropped while drop 1 is still in flight.
        // Its PATCH must wait for the first write (per-post serialization).
        await dropOnDay(page, title, dayNo(sourceDate), "first");
        await page.waitForTimeout(700);
        expect(
          patchBodies.length,
          "the reverse move's PATCH was sent while the first was still in flight"
        ).toBe(1);

        releaseFirst();
        await expect.poll(() => patchBodies.length).toBe(2);

        // Write 1: the chip keeps the wall-clock time it renders locally and
        // is rebased onto the TARGET civil date, with the offset in force
        // THERE (across the month edge; if the staged month sits on a DST
        // switch this also asserts the switch-correct offset).
        const probeParts = new Intl.DateTimeFormat("en-GB", {
          timeZone: DENVER, hourCycle: "h23", hour: "2-digit", minute: "2-digit",
        }).formatToParts(new Date(probeIso));
        const wallH = Number(probeParts.find((p) => p.type === "hour")!.value);
        const wallM = Number(probeParts.find((p) => p.type === "minute")!.value);
        const expectedCrossEdge = new Date(
          Date.UTC(
            targetDate.getUTCFullYear(),
            targetDate.getUTCMonth(),
            targetDate.getUTCDate(),
            wallH,
            wallM
          ) - denverOffHrs(new Date(targetDate.getTime() + 12 * 3_600_000).toISOString()) * 3_600_000
        ).toISOString();
        expect(new Date(patchBodies[0]).toISOString()).toBe(expectedCrossEdge);
        // Write 2, in drop order: the reverse move lands at the probe's
        // original exact instant (no offset recomputation drift).
        expect(new Date(patchBodies[1]).toISOString()).toBe(probeInstant);
        await expect(chipIn(page, dayNo(sourceDate), title, "first")).toBeVisible();
        expect(pageErrors, `page errors during drag:\n${pageErrors.join("\n")}`).toEqual([]);
      } finally {
        await deleteProbePost(probeId);
      }
    });
  });

  test.describe("backlog strip: undated drafts are datable — and undoable", () => {
    // Pinned so the expected 09:00 instant is identical on any host/CI
    // machine (the browser resolves the slot in its zone).
    test.use({ timezoneId: "America/Denver" });
    const DENVER = "America/Denver";
    const denverOffHrs = (iso: string): number => {
      const name = new Intl.DateTimeFormat("en-US", {
        timeZone: DENVER, timeZoneName: "shortOffset",
      })
        .formatToParts(new Date(iso))
        .find((p) => p.type === "timeZoneName")?.value;
      const match = /GMT([+-]?\d{1,2})/.exec(name ?? "");
      return match ? Number(match[1]) : 0;
    };

    test("drag a strip draft onto a day: the 9:00 local slot lands, Undo returns it to the strip", async ({ page }) => {
      test.setTimeout(240_000);
      const title = "QA-AUDIT backlog probe";
      const probeId = await createProbeDraft(title);
      try {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto(`${BASE}/dashboard/calendar`, { waitUntil: "domcontentloaded" });

        const strip = page.getByTestId("unscheduled-backlog");
        const stripChip = strip.locator("div.bg-card", { hasText: title });
        // The strip refetches asynchronously; the probe is the newest row
        // (unscheduled lists newest-first) so it leads the strip.
        await expect(stripChip).toBeVisible({ timeout: 90_000 });

        // The view is NOT guaranteed to be on today's month: when the current
        // month holds nothing schedulable, the calendar auto-jumps to the next
        // non-empty one, and the strip's UNDATED probe never stops that jump.
        // Anchor the target on the DATE ATTRIBUTE instead — every month view
        // renders exactly one "the 15th" cell, whatever month it is showing.
        const targetKey = String(
          await page.locator('div[data-drop-day$="-15"]').getAttribute("data-drop-day")
        );
        const targetCell = page.locator(`div[data-drop-day="${targetKey}"]`);
        // Expected slot = 09:00 LOCAL on the target day, offset resolved for
        // THAT date.
        const off = denverOffHrs(`${targetKey}T12:00:00Z`);
        const expectedSlotIso = new Date(
          Date.parse(`${targetKey}T09:00:00Z`) - off * 3_600_000
        ).toISOString();

        const patchBodies: Array<string | null> = [];
        await page.route(`**/api/posts/${probeId}`, async (route) => {
          const req = route.request();
          if (req.method() === "PATCH") {
            patchBodies.push(
              ((req.postDataJSON() as { scheduled_at?: string | null }) ?? {}).scheduled_at ?? null
            );
          }
          await route.continue();
        });

        // dragTo can die on a scroll target (the page must scroll the cell
        // into view mid-gesture, which kills the native dragstart) — the same
        // pointer-fallback that recovers swallowed dragstarts completes the
        // drop there. Retry the gesture until the chip verifiably lands.
        const chipInTarget = targetCell.locator("div.bg-card", { hasText: title }).first();
        await expect
          .poll(
            async () => {
              if ((await chipInTarget.count()) > 0) return true;
              const current = page
                .locator("div.bg-card", { hasText: title })
                .filter({ visible: true })
                .first();
              if ((await current.count()) === 0) return false;
              try {
                await current.dragTo(targetCell.locator("span").first(), {
                  timeout: 10_000,
                });
              } catch {
                // The gesture never started; the poll re-runs from wherever the chip now is.
              }
              return (await chipInTarget.count()) > 0;
            },
            { timeout: 30_000, intervals: [500], message: `drop of "${title}" never landed on ${targetKey}` }
          )
          .toBe(true);

        await expect.poll(() => patchBodies.length).toBe(1);
        expect(
          new Date(patchBodies[0] as string).toISOString(),
          "dropping a strip draft must assign the day's 09:00 local slot"
        ).toBe(expectedSlotIso);

        // The row itself: the exact assigned instant AND the untouched
        // status (a scheduled_at-only PATCH must not publish a draft).
        const { db } = adminClient();
        const rowState = async (): Promise<{ slot: string | null; status: string | null }> => {
          const row = await db
            .from("posts")
            .select("scheduled_at,status")
            .eq("id", probeId)
            .single();
          return {
            slot: row.data?.scheduled_at ? new Date(row.data.scheduled_at).toISOString() : null,
            status: row.data?.status ?? null,
          };
        };
        await expect
          .poll(rowState, { timeout: 20_000 })
          .toEqual({ slot: expectedSlotIso, status: "draft" });
        await expect(chipInTarget).toBeVisible();

        const banner = page.getByTestId("post-move-undo");
        await expect(banner).toBeVisible({ timeout: 20_000 });
        await expect(banner).toContainText(title);
        await banner.getByRole("button", { name: /undo/i }).click();

        // Undoing a backlog SCHEDULING (there was no previous slot) must
        // unschedule — scheduled_at back to null, not some re-slot value.
        await expect.poll(() => patchBodies.length).toBe(2);
        expect(patchBodies[1], "undo must unschedule, not fabricate another slot").toBeNull();

        // The chip is back in the strip and gone from the grid, and the row
        // is undated again — still a draft.
        await expect(stripChip).toBeVisible({ timeout: 20_000 });
        await expect(chipInTarget).toHaveCount(0);
        await expect(banner).toBeHidden();
        await expect
          .poll(rowState, { timeout: 20_000 })
          .toEqual({ slot: null, status: "draft" });
      } finally {
        await deleteProbePost(probeId);
      }
    });
  });
});

test.describe("saas-qa-audit · form validation states", () => {
  test("register: empty submit and short password produce inline, human-readable errors", async ({ page }) => {
    await page.goto(`${BASE}/register`, { waitUntil: "domcontentloaded" });
    // The form is React-controlled: clicking before hydration is a no-op and
    // the click's own validation never runs (this made the test flaky on a cold
    // dev-server compile). Wait for the page to settle first.
    await page.waitForLoadState("networkidle");
    // Exact label: the plan card's "starter" button also matches /start/i.
    const submit = page.getByRole("button", { name: /^start free trial$/i });
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(page.getByText(/all fields are required/i)).toBeVisible({ timeout: 15_000 });

    await page.locator("#company").fill("QA Audit Co");
    await page.locator("#email").fill(`qa-${Date.now()}@example.com`);
    await page.locator("#password").fill("short");
    await submit.click();
    await expect(page.getByText(/at least 8 characters/i)).toBeVisible({ timeout: 15_000 });
  });

  test("login: wrong credentials fail visibly, without a dead end or crash", async ({ browser }) => {
    // A fresh context: the suite's shared context is already signed in.
    const ctx = await browser.newContext({ baseURL: BASE, storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    // The login inputs are React-controlled: filling before hydration makes
    // React re-render with its empty state and silently wipes the value.
    await page.waitForTimeout(1_200);
    await page.getByLabel(/email/i).fill(`nobody-${Date.now()}@example.com`);
    await page.getByLabel(/password/i).fill("definitely-wrong-password");
    await page.getByRole("button", { name: /^sign in$/i }).click();
    // Assert the UI contract, not Supabase's exact wording (which becomes
    // "Request rate limit reached" when the QA run trips auth throttling).
    const errorBox = page.locator("p.text-red-500");
    await expect(errorBox).toBeVisible({ timeout: 30_000 });
    expect((await errorBox.innerText()).trim().length, "empty error box after a failed sign-in").toBeGreaterThan(3);
    await expect(page.getByRole("button", { name: /^sign in$/i })).toBeEnabled();
    expect(page.url()).toContain("/login");
    await ctx.close();
  });

  test("form-only endpoints answer 415 (not 500) when a JSON body is posted", async ({ request }) => {
    const res = await request.post("/api/content-map", {
      data: { file: "not-a-file" },
      headers: { "content-type": "application/json" },
      timeout: 90_000, // first hit compiles the route in dev
    });
    expect(res.status(), await res.text()).toBe(415);
  });
});

test.describe("saas-qa-audit · navigation dead ends", () => {
  test("every in-app nav destination resolves (<400)", async ({ page, request }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1_000);

    const hrefs = await page.evaluate(() => {
      const set = new Set<string>();
      for (const a of Array.from(document.querySelectorAll("a[href]"))) {
        const href = a.getAttribute("href") ?? "";
        if (href.startsWith("/") && !href.startsWith("//")) set.add(href);
      }
      return Array.from(set);
    });

    const broken: string[] = [];
    for (const href of hrefs.slice(0, 40)) {
      const res = await request.get(href, { maxRedirects: 0 }).catch(() => null);
      const status = res?.status() ?? 0;
      if (status === 0 || status >= 400) broken.push(`${href} → ${status}`);
    }
    expect(broken, `dead links:\n${broken.join("\n")}`).toHaveLength(0);
  });
});
