/**
 * calendar-ics-export — end-to-end verification of the calendar's month
 * .ics export (src/components/ContentCalendar.tsx, "Export month (.ics)").
 *
 * Rather than trusting the unit tests on buildIcs(), this drives the REAL
 * UI: signs into /dashboard/calendar as a live fixture user, clicks the
 * Export button, captures the actual browser download, and parses the file
 * offline. Everything the export promises in the header comment must hold:
 *
 *   1. Filename `content-calendar-<yyyy-MM>.ics`, calendar name = the
 *      rendered month ("Content Calendar — <MMMM yyyy>").
 *   2. Exactly one VEVENT per CURRENT-month scheduled post — the month+1
 *      counter-post staged below must NOT leak in (the export is scoped to
 *      the month being browsed).
 *   3. UID ties each VEVENT to the exact DB row (`<post-id>@agency-os`).
 *   4. DTSTART is the post's scheduled_at as an exact UTC Z stamp.
 *   5. SUMMARY survives the escape path: commas/semicolons round-trip.
 *
 * Runs against a disposable QA-AUDIT tenant like calendar-auto-jump.spec.ts;
 * destroyFixtures sweeps the tenant whole, so a failed run leaves no rows.
 * The fixture's fixed-dated cascade post is deleted first so "the month's
 * posts" is a set this test fully controls on every calendar day.
 */
import { test, expect, type BrowserContext } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import { format } from "date-fns";
import {
  adminClient,
  createFixtures,
  destroyFixtures,
  type QaFixtures,
} from "./qa-fixtures";

const BASE = process.env.AUDIT_BASE_URL ?? "http://localhost:3100";

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

/** RFC 5545 §3.1 unfolding: fold continuations (CRLF + single space) vanish. */
function unfold(ics: string): string {
  return ics.replace(/\r\n /g, "");
}

interface IcsEventFields {
  uid: string | null;
  summary: string | null;
  dtstart: string | null;
}

/** Split the (unfolded) VCALENDAR into per-VEVENT header fields. */
function eventFields(ics: string): IcsEventFields[] {
  const unfolded = unfold(ics);
  const blocks = unfolded.split("BEGIN:VEVENT").slice(1);
  return blocks.map((block) => {
    const body = block.split("END:VEVENT")[0];
    const field = (name: string): string | null => {
      const m = body.match(new RegExp(`^${name}:(.*)$`, "m"));
      return m ? m[1] : null;
    };
    const summary = field("SUMMARY");
    return {
      uid: field("UID"),
      summary: summary
        ? summary
            .replace(/\\,/g, ",")
            .replace(/\\;/g, ";")
            .replace(/\\n/g, "\n")
        : null,
      dtstart: field("DTSTART"),
    };
  });
}

/** Date -> `20261027T121500Z` (UTC, seconds precision — what utcStamp emits). */
function utcStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  );
}

test.describe.configure({ mode: "serial" });

let fx: QaFixtures;
let ctx: BrowserContext;
let db: ReturnType<typeof adminClient>["db"];

interface StagedPost {
  id: string;
  title: string;
  instant: Date;
}

/** Posts in the OPENING month — all of these must appear in the export. */
let monthPosts: StagedPost[];
/** Same month, next day/time — the export-item count signal. */
let nextMonthPost: StagedPost;

test.beforeAll(async ({ browser }) => {
  db = adminClient().db;
  fx = await createFixtures();

  // The fixture's cascade post is hard-dated ("2026-12-15"); when "today"
  // falls inside that month it would land in the opening month and break
  // the "exported set == staged set" invariant. Same treatment as the
  // auto-jump spec — destroyFixtures sweeps this tenant anyway.
  await db.from("posts").delete().eq("id", fx.postId);

  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();

  // Escape-risk title: comma + semicolon exercise §3.3.11 escaping; the
  // string stays short enough that no fold boundary is involved.
  const monthTitles = [
    `QA-AUDIT ICS month post, one; with specials 🗓️`,
    `QA-AUDIT ICS month post two`,
    `QA-AUDIT ICS month post three`,
  ];
  // Mid-month UTC instants (days 10/11/12 at 16:00Z) — inside the same
  // calendar day for every UTC offset the test context can have, and far
  // from any month boundary, so local-month classification is unambiguous.
  const inserts = monthTitles.map((title, i) =>
    db
      .from("posts")
      .insert({
        tenant_id: fx.tenantId,
        workspace_id: fx.workspaceId,
        client_id: fx.clientId,
        title,
        type: "blog",
        status: "scheduled",
        scheduled_at: new Date(Date.UTC(y, m, 10 + i, 16, 30, 0)).toISOString(),
        content: { type: "blog", title, body: "ICS export probe." },
      })
      .select("id")
      .single<{ id: string }>()
  );
  const monthRows = await Promise.all(inserts);
  monthPosts = monthRows.map((r, i) => {
    expect(r.error).toBeNull();
    return {
      id: r.data!.id,
      title: monthTitles[i],
      instant: new Date(Date.UTC(y, m, 10 + i, 16, 30, 0)),
    };
  });

  // The counter-case: same tenant, month+1. The export button only emits
  // the month being browsed, so this must stay out of the file.
  nextMonthPost = {
    id: (
      await db
        .from("posts")
        .insert({
          tenant_id: fx.tenantId,
          workspace_id: fx.workspaceId,
          client_id: fx.clientId,
          title: "QA-AUDIT ICS next-month counter-post",
          type: "blog",
          status: "scheduled",
          scheduled_at: new Date(Date.UTC(y, m + 1, 10, 16, 0, 0)).toISOString(),
          content: { type: "blog", title: "QA-AUDIT ICS next-month counter-post", body: "" },
        })
        .select("id")
        .single<{ id: string }>()
    ).data!.id,
    title: "QA-AUDIT ICS next-month counter-post",
    instant: new Date(Date.UTC(y, m + 1, 10, 16, 0, 0)),
  };

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
    storageState: { cookies: [], origins: [] },
  });
  await ctx.addCookies([sessionCookie(fx.url, BASE, signedIn.data.session)]);
});

test.afterAll(async () => {
  await ctx?.close();
  if (fx) await destroyFixtures(fx);
});

test("the Export button downloads an .ics holding exactly the month's posts", async () => {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/dashboard/calendar`, { waitUntil: "domcontentloaded" });

  // Wait until the opening month actually renders the staged posts (dev
  // compile window included, like the rest of the qa suites). The opening
  // month is non-empty, so the auto-jump must not fire, and the browser's
  // month filter matches the fixture rows we control.
  const chip = page
    .locator("div.cursor-grab, div.cursor-pointer")
    .filter({ hasText: monthPosts[0].title })
    .filter({ visible: true });
  await expect(chip.first()).toBeVisible({ timeout: 60_000 });

  const monthKey = monthPosts[0].instant
    .toISOString()
    .slice(0, 7); // yyyy-MM of the opening month's staged rows

  // The button's accessible name is its content ("Export"); the month text
  // lives in its title tooltip, so locate via that unique title prefix
  // instead of the accessible-name collision any future Export button adds.
  const exportButton = page.locator('button[title^="Download the"]').filter({ visible: true });
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    exportButton.click(),
  ]);

  expect(download.suggestedFilename()).toBe(`content-calendar-${monthKey}.ics`);
  const path = await download.path();
  const ics = fs.readFileSync(path, "utf8");

  // Calendar name: the rendered month, verbatim (no comma — no escaping).
  expect(ics).toContain(`X-WR-CALNAME:Content Calendar — ${format(new Date(), "MMMM yyyy")}`);

  const events = eventFields(ics);
  const byUid = new Map(events.map((e) => [e.uid, e]));

  // Exactly the staged set: no counter-post, no stray fixture row.
  expect(events).toHaveLength(monthPosts.length);
  expect(ics).not.toContain(nextMonthPost.title);
  expect(ics).not.toContain(nextMonthPost.id);

  for (const post of monthPosts) {
    const ev = byUid.get(`${post.id}@agency-os`);
    expect(ev, `VEVENT for ${post.title}`).toBeTruthy();
    // Title fidelity through the §3.3.11 escape path.
    expect(ev!.summary).toBe(post.title);
    // Instant fidelity: scheduled_at as an exact UTC Z stamp.
    expect(ev!.dtstart).toBe(utcStamp(post.instant));
  }

  await page.close();
});
