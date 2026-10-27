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
