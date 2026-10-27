/**
 * calendar-week-strip-mobile — the week strip's drag contract on a REAL
 * phone emulation, run by the chromium-mobile project (isMobile + hasTouch).
 *
 * The desktop twin lives in saas-qa-ui.spec.ts ("desktop week strip: HTML5
 * dragTo reschedules to the adjacent day"); that one only ever runs on a
 * mouse-driven desktop context, so a refactor that breaks the strip under
 * touch emulation would pass it silently. This copy pins the same contract
 * under the phone project:
 *
 *   1. The strip exposes the drag affordance: draggable chips over the 7
 *      [data-drop-day] targets.
 *   2. dragTo reschedules the chip to the adjacent day — retried because a
 *      swallowed gesture is a strict no-op.
 *   3. The PATCH rebases the chip's local wall time onto the target date
 *      with the offset in force there (ContentCalendar.rescheduleToDay).
 */
import { test, expect } from "@playwright/test";
import fs from "fs";
import { adminClient } from "./qa-fixtures";

const BASE = process.env.AUDIT_BASE_URL ?? "http://localhost:3100";

/** Same probe helpers the saas-qa-audit suites use, wired through the
 * qa-fixtures admin client so `.env.local` is loaded the same way. */
function sessionIds(): { tenantId: string | null; workspaceId: string | null } {
  try {
    const state = JSON.parse(
      fs.readFileSync("test-results/.audit-auth-storage.json", "utf8")
    );
    const cookies: Array<{ name: string; value: string }> = state.cookies ?? [];
    const tenantCookie = cookies.find((c) => c.name === "x-tenant-id")?.value ?? "";
    // Signed as `<uuid>.<hmac>` — the value is everything before the last dot.
    const tenantId = tenantCookie.includes(".")
      ? tenantCookie.slice(0, tenantCookie.lastIndexOf("."))
      : tenantCookie;
    const workspaceId =
      cookies.find((c) => c.name === "workspace_id")?.value ?? null;
    return { tenantId: tenantId || null, workspaceId };
  } catch {
    return { tenantId: null, workspaceId: null };
  }
}

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

/** Disposable UNDATED draft — the Unscheduled backlog strip's source row.
 * Same shape the saas-qa-audit suites insert; here used on a phone emulation. */
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

test.setTimeout(300_000);

test("phone week strip: dragTo reschedules to the adjacent day", async ({ page }) => {
  // 16:00Z is 10:00 America/Denver on MDT days — always inside the week the
  // strip opens on. The viewport (390×844, isMobile, hasTouch) comes from
  // the chromium-mobile project; do NOT setViewportSize here, the point of
  // this project is the real emulation.
  const at = new Date();
  at.setUTCHours(16, 0, 0, 0);
  const probeId = await createProbePost("QA-AUDIT phone week drag probe", at.toISOString());
  try {
    await page.goto(`${BASE}/dashboard/calendar`, { waitUntil: "domcontentloaded" });

    // Week-strip cells carry the full Denver-local date on [data-drop-day].
    const weekCell = (dateKey: string) => page.locator(`[data-drop-day="${dateKey}"]`);
    const chipInWeek = (dateKey: string) =>
      weekCell(dateKey)
        .locator("div.bg-card", { hasText: "QA-AUDIT phone week drag probe" })
        .first();

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

    // Wait for hydration + posts. Phones open on the week strip: draggable
    // chips over one drop row per day, wired with the same [data-drop-day]
    // targets as the desktop strip.
    const probeChip = page
      .locator("div.bg-card", { hasText: "QA-AUDIT phone week drag probe" })
      .filter({ visible: true })
      .first();
    await expect(probeChip).toBeVisible({ timeout: 90_000 });
    expect(
      await page.locator("div[draggable='true']").filter({ visible: true }).count(),
      "the phone week strip does not expose draggable chips"
    ).toBeGreaterThan(0);
    expect(
      await page.locator("[data-drop-day]").filter({ visible: true }).count(),
      "the phone week strip does not expose the 7 day drop targets"
    ).toBe(7);

    // Verify the strip owns the DOM (week rows carry a `w-12` label column
    // the month grid never renders). Re-assert defensively even though the
    // phone default is the week strip.
    await expect
      .poll(
        async () =>
          (await page.locator(`[data-drop-day="${todayKey}"] div.w-12`).count()) > 0,
        { timeout: 30_000, intervals: [1_000], message: "the calendar never opened on the week strip" },
      )
      .toBe(true);

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

    // Same swallowed-gesture retry as the desktop strip and month-grid drags:
    // re-attempt the gesture until the chip verifiably lands on the target row.
    await expect
      .poll(
        async () => {
          if ((await chipInWeek(targetKey).count()) > 0) return true;
          const current = page
            .locator("div.bg-card", { hasText: "QA-AUDIT phone week drag probe" })
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
        { timeout: 30_000, intervals: [500], message: `the phone week-strip drop never landed on ${targetKey}` },
      )
      .toBe(true);

    // Mirror of rescheduleToDay: the chip keeps the wall hours it renders
    // locally and is rebased onto the target date with the offset in force
    // THERE (the target day's offset is the one 10:00 wall sees on every
    // adjacent pair; Denver's switches at 02:00 local).
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
    await expect(chipInWeek(targetKey)).toBeVisible();
    expect(pageErrors, `page errors during drag:\n${pageErrors.join("\n")}`).toEqual([]);
  } finally {
    await deleteProbePost(probeId);
  }
});

test.describe("phone: datable backlog drafts on the week strip", () => {
  // Pinned so the expected 09:00 instant is identical on any host/CI machine
  // (the browser resolves the slot in its zone).
  test.use({ timezoneId: "America/Denver" });

  // Phone twin of the desktop backlog probe in saas-qa-ui.spec.ts:
  // dropping a strip draft onto a WEEK-STRIP row (not a month-grid cell) must
  // assign the day's 09:00 local slot without publishing the draft, and Undo
  // must unschedule it back to the strip.
  test("drag a backlog draft onto a week-strip row: the 9:00 slot lands, Undo returns it to the strip", async ({ page }) => {
    const title = "QA-AUDIT phone backlog probe";
    const probeId = await createProbeDraft(title);
    try {
      await page.goto(`${BASE}/dashboard/calendar`, { waitUntil: "domcontentloaded" });

      const strip = page.getByTestId("unscheduled-backlog");
      const stripChip = strip.locator("div.bg-card", { hasText: title });
      // The strip refetches asynchronously; the probe is the newest row
      // (unscheduled lists newest-first) so it leads the strip.
      await expect(stripChip).toBeVisible({ timeout: 90_000 });

      // Phones open on the week strip, but re-assert defensively: poll until
      // the strip owns the DOM (week rows carry a `w-12` label column the
      // month grid never renders), clicking the Week button until they do.
      // A pre-hydration click is a silent no-op, so retry until it takes.
      const todayKey = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit",
      }).format(new Date());
      const utcOfKey = (k: string) => {
        const [y, mo, d] = k.split("-").map(Number);
        return Date.UTC(y, mo - 1, d);
      };
      const dow = new Date(utcOfKey(todayKey)).getUTCDay();
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

      // The target must be a RENDERED strip cell: the strip exposes only its
      // own 7 days. Sunday-Friday drop on the next day, Saturday on the
      // previous one — inside the week, today's row always carries a chip.
      const targetKey = new Date(
        utcOfKey(todayKey) + (dow === 6 ? -86_400_000 : +86_400_000),
      ).toISOString().slice(0, 10);
      const targetCell = page.locator(`[data-drop-day="${targetKey}"]`);

      // Expected slot = 09:00 LOCAL on the target day, offset resolved for
      // THAT date (the backlog drop resolves the drop date's own DST state,
      // it never reuses today's).
      const offHours = (iso: string): number => {
        const name = new Intl.DateTimeFormat("en-US", {
          timeZone: "America/Denver", timeZoneName: "shortOffset",
        })
          .formatToParts(new Date(iso))
          .find((p) => p.type === "timeZoneName")?.value;
        const match = /GMT([+-]?\d{1,2})/.exec(name ?? "");
        return match ? Number(match[1]) : 0;
      };
      const off = offHours(`${targetKey}T12:00:00Z`);
      const expectedSlotIso = new Date(
        Date.parse(`${targetKey}T09:00:00Z`) - off * 3_600_000
      ).toISOString();

      const pageErrors: string[] = [];
      page.on("pageerror", (err) => pageErrors.push(err.message));

      const patchBodies: Array<string | null> = [];
      await page.route(`**/api/posts/${probeId}`, async (route) => {
        const req = route.request();
        if (req.method() === "PATCH") {
          patchBodies.push(
            ((req.postDataJSON() as { scheduled_at?: string | null }) ?? {}).scheduled_at ?? null,
          );
        }
        await route.continue();
      });

      // Same swallowed-gesture retry as every other drag here: re-attempt
      // until the chip verifiably lands on the target row; a swallowed
      // attempt is a strict no-op, so retries cannot overshoot.
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
              await current.dragTo(targetCell, { timeout: 10_000 });
            } catch {
              // The gesture never started; the poll re-runs.
            }
            return (await chipInTarget.count()) > 0;
          },
          { timeout: 30_000, intervals: [500], message: `the phone backlog drop never landed on ${targetKey}` },
        )
        .toBe(true);

      // Exactly one write, and it is the 09:00 local slot.
      await expect.poll(() => patchBodies.length).toBe(1);
      expect(
        new Date(patchBodies[0] as string).toISOString(),
        "dropping a strip draft must assign the day's 09:00 local slot",
      ).toBe(expectedSlotIso);
      await expect(chipInTarget).toBeVisible();

      // The row itself: exact assigned instant AND the untouched status —
      // a scheduled_at-only PATCH must not publish a draft.
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

      // Undo puts it back: a backlog SCHEDULING had no previous slot, so the
      // undo is an UNSCHEDULE — scheduled_at back to null, never re-slot.
      const banner = page.getByTestId("post-move-undo");
      await expect(banner).toBeVisible({ timeout: 20_000 });
      await expect(banner).toContainText(title);
      await banner.getByRole("button", { name: /undo/i }).click();

      await expect.poll(() => patchBodies.length).toBe(2);
      expect(patchBodies[1], "undo must unschedule, not fabricate another slot").toBeNull();
      await expect(stripChip).toBeVisible({ timeout: 20_000 });
      await expect(chipInTarget).toHaveCount(0);
      await expect(banner).toBeHidden();
      await expect
        .poll(rowState, { timeout: 20_000 })
        .toEqual({ slot: null, status: "draft" });
      expect(pageErrors, `page errors during drag:\n${pageErrors.join("\n")}`).toEqual([]);
    } finally {
      await deleteProbePost(probeId);
    }
  });
});

test.describe("phone: datable backlog drafts on the month grid", () => {
  // Pinned so the expected 09:00 instant is identical on any host/CI machine
  // (the browser resolves the slot in its zone).
  test.use({ timezoneId: "America/Denver" });

  // Phone twin of the month-grid backlog drop: switching to the Month view
  // must expose the same [data-drop-day] cells, and a strip draft dropped on
  // one must assign that day's 09:00 LOCAL slot (offset resolved for the
  // TARGET date — the 9:00-equivalent instant, not today's offset) under
  // touch emulation, with exactly one PATCH. The pointer drag path is what
  // runs on this project (native HTML5 DnD never starts under touch), so a
  // pass here proves the fallback gesture wiring covers the month grid.
  test("drag a backlog draft onto a month-grid cell: the 9:00 slot lands under touch emulation", async ({ page }) => {
    const title = "QA-AUDIT phone month-grid probe";
    const probeId = await createProbeDraft(title);
    try {
      await page.goto(`${BASE}/dashboard/calendar`, { waitUntil: "domcontentloaded" });

      const stripChip = page
        .getByTestId("unscheduled-backlog")
        .locator("div.bg-card", { hasText: title });
      await expect(stripChip).toBeVisible({ timeout: 90_000 });

      // Switch to the Month view; retry until the month grid owns the DOM
      // (a pre-hydration click is a silent no-op).
      const todayKey = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit",
      }).format(new Date());
      const utcOfKey = (k: string) => {
        const [y, mo, d] = k.split("-").map(Number);
        return Date.UTC(y, mo - 1, d);
      };
      const dow = new Date(utcOfKey(todayKey)).getUTCDay();
      // Drop adjacent to today (Sat on the previous day) — same in-week rule
      // as the week-strip probes, and the cell is always in the RENDERED
      // month (no month-navigation edge cases in scope here).
      const targetKey = new Date(
        utcOfKey(todayKey) + (dow === 6 ? -86_400_000 : +86_400_000),
      ).toISOString().slice(0, 10);
      // min-h-[110px] pins this to the month grid (the week strip's rows are
      // shorter); today's own cell guarantees the month is in view.
      const targetCell = page
        .locator(`[data-drop-day="${targetKey}"].min-h-\\[110px\\]`);
      await expect
        .poll(
          async () => {
            const inMonth = (await targetCell.count()) > 0;
            if (!inMonth) {
              await page
                .getByRole("group", { name: "Calendar view" })
                .getByRole("button", { name: "Month" })
                .click()
                .catch(() => undefined);
            }
            return inMonth;
          },
          { timeout: 30_000, intervals: [1_000], message: "the calendar never switched to the month grid" },
        )
        .toBe(true);

      const pageErrors: string[] = [];
      page.on("pageerror", (err) => pageErrors.push(err.message));

      const patchBodies: Array<string | null> = [];
      await page.route(`**/api/posts/${probeId}`, async (route) => {
        const req = route.request();
        if (req.method() === "PATCH") {
          patchBodies.push(
            ((req.postDataJSON() as { scheduled_at?: string | null }) ?? {}).scheduled_at ?? null,
          );
        }
        await route.continue();
      });

      // Expected slot = 09:00 local on the TARGET day, offset resolved for
      // THAT date. Verify the exact instant AND that the stored row kept the
      // draft status (a scheduling PATCH must not publish).
      const offHours = (iso: string): number => {
        const name = new Intl.DateTimeFormat("en-US", {
          timeZone: "America/Denver", timeZoneName: "shortOffset",
        })
          .formatToParts(new Date(iso))
          .find((p) => p.type === "timeZoneName")?.value;
        const match = /GMT([+-]?\d{1,2})/.exec(name ?? "");
        return match ? Number(match[1]) : 0;
      };
      const off = offHours(`${targetKey}T12:00:00Z`);
      const expectedSlotIso = new Date(
        Date.parse(`${targetKey}T09:00:00Z`) - off * 3_600_000,
      ).toISOString();

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
              await current.dragTo(targetCell, { timeout: 10_000 });
            } catch {
              // The gesture never started; the poll re-runs.
            }
            return (await chipInTarget.count()) > 0;
          },
          { timeout: 60_000, intervals: [500], message: `the phone month-grid drop never landed on ${targetKey}` },
        )
        .toBe(true);

      // Exactly one write, and it is the day's 09:00-equivalent slot.
      await expect.poll(() => patchBodies.length).toBe(1);
      expect(
        new Date(patchBodies[0] as string).toISOString(),
        "dropping a strip draft on a month cell must assign the day's 09:00 local slot",
      ).toBe(expectedSlotIso);
      await expect(chipInTarget).toBeVisible();

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
      expect(pageErrors, `page errors during drag:\n${pageErrors.join("\n")}`).toEqual([]);
    } finally {
      await deleteProbePost(probeId);
    }
  });
});
