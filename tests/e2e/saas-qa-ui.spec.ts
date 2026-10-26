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

  // The post chip on the month grid. Located structurally: the label is only
  // asserted in the chip test, so the rest of the suite does not depend on it.
  // Post chip on the month grid, located structurally. The chip's class list
  // goes through twMerge (cn()), so the drag refactor's conditional
  // `cursor-grab` conflicts with and evicts `cursor-pointer` — dated scheduled
  // chips render as cursor-grab only. Match either cursor class.
  const chip = (page: Page) =>
    page.locator("div.cursor-grab, div.cursor-pointer").first();

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
  // They also require the view's open month to be October 2026, so they
  // skip outside that window. Run the suite during October 2026 to
  // exercise them.
  test.describe("drag mechanics at a DST boundary inside the view", () => {
    test.describe.configure({ mode: "serial" });
    test.use({ timezoneId: "Europe/Berlin" });

    const DST_WINDOW = (() => {
      const now = new Date();
      return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}` === "2026-10";
    })();

    test("drag across the DST boundary keeps the same local wall time", async ({ page }) => {
      test.skip(!DST_WINDOW, "hardcodes the Oct 24→26 2026 Berlin DST boundary; run in October 2026");
      test.setTimeout(240_000);
      const probeId = await createProbePost("QA-AUDIT DST probe", "2026-10-26T09:00:00Z"); // 10:00 CET
      try {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto(`${BASE}/dashboard/calendar`, { waitUntil: "domcontentloaded" });
        const chip = chipIn(page, "26", "QA-AUDIT DST probe");
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

        await chip.dragTo(cellByDay(page, "24").locator("span").first());

        await expect.poll(() => patchBodies.length).toBeGreaterThan(0);
        expect(new Date(patchBodies[0]).toISOString()).toBe("2026-10-24T08:00:00.000Z");
        // The chip itself lands on the target day.
        await expect(chipIn(page, "24", "QA-AUDIT DST probe")).toBeVisible();
        // A dropped drop must not crash the page.
        expect(pageErrors, `page errors during drag:\n${pageErrors.join("\n")}`).toEqual([]);
      } finally {
        await deleteProbePost(probeId);
      }
    });

    test("drag to the wrong day offers Undo, which restores the previous exact instant", async ({ page }) => {
      test.skip(!DST_WINDOW, "hardcodes the Oct 24→26 2026 Berlin DST boundary; run in October 2026");
      test.setTimeout(240_000);
      const probeId = await createProbePost("QA-AUDIT Undo probe", "2026-10-26T09:00:00Z");
      try {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto(`${BASE}/dashboard/calendar`, { waitUntil: "domcontentloaded" });
        const chip = chipIn(page, "26", "QA-AUDIT Undo probe");
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

        await chip.dragTo(cellByDay(page, "24").locator("span").first());

        const banner = page.getByTestId("post-move-undo");
        await expect(banner).toBeVisible({ timeout: 20_000 });
        await expect(banner).toContainText("QA-AUDIT Undo probe");
        await expect(banner).toContainText(/Oct\s*24/);

        await banner.getByRole("button", { name: /undo/i }).click();
        // The undo is itself a move: second PATCH carries the exact instant the
        // row had before the drop — restored verbatim, no offset recomputation.
        await expect.poll(() => patchBodies.length).toBe(2);
        expect(new Date(patchBodies[1]).toISOString()).toBe("2026-10-26T09:00:00.000Z");
        await expect(chipIn(page, "26", "QA-AUDIT Undo probe")).toBeVisible();
        await expect(banner).toBeHidden();
      } finally {
        await deleteProbePost(probeId);
      }
    });

    test("double drop: the reverse re-drop waits for the in-flight PATCH, then applies exactly (last drop wins)", async ({ page }) => {
      test.skip(!DST_WINDOW, "hardcodes the Oct 24→26 2026 Berlin DST boundary; run in October 2026");
      test.setTimeout(240_000);
      const probeId = await createProbePost("QA-AUDIT double-drop probe", "2026-10-26T09:00:00Z");
      try {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto(`${BASE}/dashboard/calendar`, { waitUntil: "domcontentloaded" });
        const chip = chipIn(page, "26", "QA-AUDIT double-drop probe");
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

        // Drop 1: Oct 26 → Oct 24, response held by the gate.
        await chip.dragTo(cellByDay(page, "24").locator("span").first());
        await expect.poll(() => patchBodies.length).toBe(1);

      // The reverse move is dropped while drop 1 is still in flight. Its PATCH
      // must NOT be sent until the first completes (per-post serialization) —
      // otherwise the slower first write could land last and strand the row at
      // the earlier instant while the UI shows the later day.
      await chipIn(page, "24", "QA-AUDIT double-drop probe")
        .dragTo(cellByDay(page, "26").locator("span").first());
      await page.waitForTimeout(700);
      expect(
        patchBodies.length,
        "the reverse move's PATCH was sent while the first was still in flight"
      ).toBe(1);

      releaseFirst();
      await expect.poll(() => patchBodies.length).toBe(2);
      // Serialized in drop order; the final write is the reverse move's exact
      // value, and the chip ends where the user last dropped it.
      expect(new Date(patchBodies[0]).toISOString()).toBe("2026-10-24T08:00:00.000Z");
      expect(new Date(patchBodies[1]).toISOString()).toBe("2026-10-26T09:00:00.000Z");
      await expect(chipIn(page, "26", "QA-AUDIT double-drop probe")).toBeVisible();

      // A drop on the post's own day is a no-op: no third PATCH.
      await chipIn(page, "26", "QA-AUDIT double-drop probe")
        .dragTo(cellByDay(page, "26").locator("span").first());
      await page.waitForTimeout(500);
      expect(patchBodies.length, "same-day drop fired a reschedule").toBe(2);
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
