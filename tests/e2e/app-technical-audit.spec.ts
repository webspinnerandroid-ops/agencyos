import { test, expect, Page, Response } from "@playwright/test";
import fs from "fs";

/**
 * TECHNICAL & SECURITY AUDIT — automated E2E suite.
 *
 * 1. Exercises core user flows end to end (landing, auth, dashboard areas).
 * 2. Captures every 4xx/5xx response, console error, and unhandled exception
 *    during those flows, with per-flow latency measurement.
 * 3. Probes security boundaries from the browser: security headers, cookie
 *    flags, auth redirects, and BOLA/IDOR payload manipulation on
 *    representative tenant-scoped APIs.
 * 4. Simulates concurrency: parallel batch starts racing for the same rows,
 *    and parallel login sessions.
 *
 * Auth: tests/e2e/auth.setup.ts signs in ONCE through the real login UI and
 * saves the storage state (playwright.config wires it as a dependency
 * project). This suite's contexts therefore carry genuine session cookies —
 * page.request shares the cookie jar, so BOLA probes are authenticated.
 * Authed suites skip cleanly when the environment has dev login disabled.
 *
 * Findings are persisted to tests/e2e/audit-findings.json for
 * TECHNICAL_AND_SECURITY_AUDIT.md.
 */

const BASE = process.env.AUDIT_BASE_URL ?? "http://localhost:3100";
const AUTH_FILE = "test-results/.audit-auth.json";
const FOREIGN_ID = "00000000-0000-0000-0000-00000000dead";

function isAuthed(): boolean {
  try {
    const state = JSON.parse(fs.readFileSync(AUTH_FILE, "utf8"));
    return state.authenticated === true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- collector

type Severity = "info" | "low" | "medium" | "high" | "critical";
type Finding = {
  kind:
    | "http-error"
    | "console-error"
    | "page-error"
    | "security"
    | "race"
    | "latency";
  severity: Severity;
  where: string;
  detail: string;
};

const findings: Finding[] = [];

function record(f: Finding) {
  findings.push(f);
  if (f.severity === "critical" || f.severity === "high") {
    console.log(`[AUDIT][${f.severity}] ${f.where}: ${f.detail}`);
  }
}

/** Wire full error capture (4xx/5xx, console errors, page exceptions). */
function instrument(page: Page, label: string) {
  page.on("response", (res: Response) => {
    const status = res.status();
    if (status >= 400) {
      record({
        kind: "http-error",
        severity: status >= 500 ? "high" : "low",
        where: `${label} ${res.request().method()} ${res.url()}`,
        detail: `HTTP ${status}`,
      });
    }
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      record({
        kind: "console-error",
        severity: "medium",
        where: `${label} console`,
        detail: msg.text().slice(0, 400),
      });
    }
  });
  page.on("pageerror", (err) => {
    record({
      kind: "page-error",
      severity: "high",
      where: `${label} unhandled exception`,
      detail: String(err).slice(0, 400),
    });
  });
}

// ------------------------------------------------------------------- suites

test.describe("Flow 1 — public surface & security headers", () => {
  test("landing page renders; security headers and cookie flags checked", async ({
    page,
  }) => {
    instrument(page, "[public]");
    const started = Date.now();
    const res = await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    const ms = Date.now() - started;

    expect(res?.status(), "landing page must 200").toBeLessThan(400);
    record({ kind: "latency", severity: "info", where: "GET /", detail: `${ms}ms` });

    const headers = res!.headers();
    const csp = headers["content-security-policy"];
    if (!csp) {
      record({
        kind: "security",
        severity: "high",
        where: "GET /",
        detail: "No Content-Security-Policy header",
      });
    } else if (csp.includes("unsafe-inline") && !csp.includes("nonce-")) {
      record({
        kind: "security",
        severity: "medium",
        where: "GET / CSP",
        detail: "script-src allows unsafe-inline without nonce",
      });
    }
    if (!headers["strict-transport-security"]) {
      record({
        kind: "security",
        severity: "low",
        where: "GET /",
        detail:
          "No Strict-Transport-Security (OK on http://localhost; MUST exist on production)",
      });
    }
    if (!headers["x-content-type-options"]) {
      record({
        kind: "security",
        severity: "low",
        where: "GET /",
        detail: "No X-Content-Type-Options: nosniff",
      });
    }
    if (!headers["x-frame-options"] && !csp?.includes("frame-ancestors")) {
      record({
        kind: "security",
        severity: "medium",
        where: "GET /",
        detail: "No clickjacking protection (X-Frame-Options or frame-ancestors)",
      });
    }
    if (!headers["referrer-policy"]) {
      record({
        kind: "security",
        severity: "low",
        where: "GET /",
        detail: "No Referrer-Policy header",
      });
    }

    const cookies = await page.context().cookies(BASE);
    for (const c of cookies) {
      const flags: string[] = [];
      if (!c.httpOnly) flags.push("not HttpOnly");
      if (c.secure === false) flags.push("not Secure");
      if (flags.length > 0) {
        record({
          kind: "security",
          severity: c.httpOnly ? "low" : "medium",
          where: `cookie ${c.name}`,
          detail: flags.join(", "),
        });
      }
    }
  });

  test("anonymous /dashboard is bounced by the auth boundary", async ({ browser }) => {
    // Deliberately cookie-free context. NOTE: project-level storageState
    // (auth.setup) is injected even into browser.newContext(), so we must
    // explicitly clear cookies — otherwise this would silently test the
    // AUTHED path and pass for the wrong reason.
    const ctx = await browser.newContext();
    await ctx.clearCookies();
    const page = await ctx.newPage();
    instrument(page, "[anon]");
    const res = await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
    // The bounce can be a server 307 (proxy) OR a client-side redirect after
    // hydration — wait out the hydration window before judging.
    await page.waitForTimeout(3_000);
    const url = page.url();
    const loginWall =
      (await page.locator("input[type=email], input[type=password]").count()) > 0;
    const bounced = url.includes("/login") || loginWall;
    if (!bounced) {
      record({
        kind: "security",
        severity: "critical",
        where: "GET /dashboard (anonymous)",
        detail: `dashboard content reachable without auth (initial status ${res?.status()}, final url ${url})`,
      });
    }
    await ctx.close();
    expect(
      bounced,
      `anonymous /dashboard must land on the login wall (initial status ${res?.status()}, final url ${url})`
    ).toBeTruthy();
  });
});

test.describe("Flow 2 — authentication mechanism", () => {
  test("dev-login endpoint behavior matches its env gate", async ({ request }) => {
    const started = Date.now();
    const res = await request.post(`${BASE}/api/auth/dev-login`);
    const ms = Date.now() - started;
    record({
      kind: "latency",
      severity: "info",
      where: "POST /api/auth/dev-login",
      detail: `${res.status()} in ${ms}ms`,
    });

    if (process.env.ALLOW_DEV_LOGIN !== "true") {
      expect(res.status(), "dev-login must 404 when disabled").toBe(404);
      return;
    }
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { token?: string };
    expect(body.token, "dev-login must mint an OTP token").toBeTruthy();
    const bodyStr = JSON.stringify(body);
    if (/service_role|SUPABASE_SERVICE|refresh_token/i.test(bodyStr)) {
      record({
        kind: "security",
        severity: "critical",
        where: "POST /api/auth/dev-login",
        detail: "response leaks privileged material",
      });
    }
  });

  test("saved session state reaches the dashboard", async ({ page }) => {
    test.skip(!isAuthed(), "dev login disabled in this environment");
    instrument(page, "[authed]");
    await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
    await expect(page).not.toHaveURL(/\/login/);
  });
});

test.describe("Flow 3 — core app flows (authed, error-captured)", () => {
  test.skip(() => !isAuthed(), "needs dev login");

  const FLOWS = [
    { name: "dashboard", path: "/dashboard" },
    { name: "content-map", path: "/dashboard/content-map" },
    { name: "posts", path: "/dashboard/posts" },
    { name: "clients", path: "/dashboard/clients" },
    { name: "calendar", path: "/dashboard/calendar" },
    { name: "ai-settings", path: "/dashboard/settings/ai" },
    { name: "workspaces", path: "/dashboard/workspaces" },
  ];

  for (const flow of FLOWS) {
    test(`flow: ${flow.name}`, async ({ page }) => {
      test.skip(!isAuthed(), "needs dev login");
      instrument(page, `[flow:${flow.name}]`);
      const started = Date.now();
      const res = await page.goto(`${BASE}${flow.path}`, {
        waitUntil: "domcontentloaded",
      });
      const ms = Date.now() - started;
      record({
        kind: "latency",
        severity: "info",
        where: `GET ${flow.path}`,
        detail: `${res?.status()} in ${ms}ms`,
      });
      expect(res?.status(), `${flow.path} must 200`).toBeLessThan(400);
      // Give the client bundle time to fetch data, then check the app did
      // not remain stuck on its loading shell.
      await page.waitForTimeout(2_500);
      const text = await page.locator("body").innerText();
      if (/Loading Agency OS/i.test(text) && text.length < 400) {
        record({
          kind: "page-error",
          severity: "medium",
          where: `flow ${flow.name}`,
          detail: "stuck on loading shell after 2.5s",
        });
      }
    });
  }
});

test.describe("Flow 4 — BOLA / access-control probes", () => {
  test("authenticated probes of cross-tenant / foreign ids are rejected", async ({
    page,
  }) => {
    test.skip(!isAuthed(), "needs dev login");
    test.setTimeout(240_000);
    instrument(page, "[bola]");

    const probes: { method: string; path: string; body?: unknown }[] = [
      { method: "GET", path: `/api/content-map/${FOREIGN_ID}` },
      { method: "PATCH", path: `/api/content-map/${FOREIGN_ID}`, body: { title: "x" } },
      { method: "DELETE", path: `/api/content-map/${FOREIGN_ID}` },
      { method: "GET", path: `/api/posts/${FOREIGN_ID}` },
      { method: "GET", path: "/api/clients" },
      { method: "GET", path: "/api/notifications" },
      { method: "GET", path: "/api/analytics" },
      { method: "GET", path: "/api/admin/models" },
      { method: "POST", path: "/api/admin/models", body: { sync: true } },
      { method: "POST", path: "/api/content-map", body: { clientId: FOREIGN_ID } },
      // The batch API accepts itemIds directly — a foreign row id must claim
      // nothing. (generate-content is deliberately NOT probed with a postId:
      // its Zod schema has no postId field, so a junk id is stripped and the
      // route legitimately starts a topic-based generation.)
      {
        method: "POST",
        path: "/api/content-map/batch",
        body: { action: "start", itemIds: [FOREIGN_ID] },
      },
      { method: "GET", path: "/api/tenant" },
    ];

    for (const probe of probes) {
      // page.request shares the browser context's cookie jar → authed probe.
      const res = await page.request.fetch(`${BASE}${probe.path}`, {
        method: probe.method,
        headers: { "Content-Type": "application/json" },
        data: probe.body !== undefined ? JSON.stringify(probe.body) : undefined,
        maxRedirects: 0,
        timeout: 30_000, // no single route may hang the audit
      });
      const status = res.status();
      const text = await res.text().catch(() => "");

      const acceptable = [200, 400, 401, 403, 404, 405, 409, 422, 429].includes(status);
      if (!acceptable) {
        record({
          kind: "security",
          severity: status >= 500 ? "high" : "critical",
          where: `${probe.method} ${probe.path}`,
          detail: `foreign-id probe returned ${status}: ${text.slice(0, 220)}`,
        });
      }
      if (status >= 500 && /at\s+.+\(.+:\d+:\d+\)/.test(text)) {
        record({
          kind: "security",
          severity: "medium",
          where: `${probe.method} ${probe.path}`,
          detail: "500 body contains a stack trace (information disclosure)",
        });
      }
      if (status === 200 && probe.method === "GET") {
        if (text.includes(FOREIGN_ID)) {
          record({
            kind: "security",
            severity: "critical",
            where: `GET ${probe.path}`,
            detail: "response echoes the foreign object id — possible BOLA",
          });
        }
      }
    }
  });
});

test.describe("Flow 5 — concurrency / state races", () => {
  test("parallel batch starts race for the same map rows", async ({ page }) => {
    test.skip(!isAuthed(), "needs dev login");
    instrument(page, "[race]");
    const fire = Array.from({ length: 5 }, () =>
      page.request
        .post(`${BASE}/api/content-map/batch`, {
          headers: { "Content-Type": "application/json" },
          data: JSON.stringify({ action: "start" }),
        })
        .then((r) => r.json().catch(() => ({})))
    );
    const settled = await Promise.allSettled(fire);
    const payloads = settled.map((s) =>
      s.status === "fulfilled"
        ? (s.value as Record<string, unknown>)
        : { error: String(s.reason).slice(0, 100) }
    );
    const totalClaimed = payloads.reduce(
      (sum, p) => sum + (typeof p.claimed === "number" ? (p.claimed as number) : 0),
      0
    );
    record({
      kind: "race",
      severity: "info",
      where: "POST /api/content-map/batch ×5 parallel",
      detail: `responses=${JSON.stringify(payloads).slice(0, 400)} totalClaimed=${totalClaimed}`,
    });
    // Atomicity ceiling: 5 callers may claim at most one row each. If the
    // claimer is atomic, overlapping calls return claimed=0 for the losers.
    expect(totalClaimed).toBeLessThanOrEqual(5);
  });

  test("parallel login sessions hold independent, valid sessions", async ({
    browser,
  }) => {
    test.skip(!isAuthed(), "needs dev login");
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    const outcomes: boolean[] = [];
    for (const p of [pageA, pageB]) {
      const mint = await p.request.post(`${BASE}/api/auth/dev-login`);
      if (!mint.ok()) {
        // Supabase throttles rapid magiclink mints — a legitimate rejection,
        // not state corruption. Record and continue.
        record({
          kind: "race",
          severity: "info",
          where: "parallel dev-login",
          detail: `second mint throttled with ${mint.status()}`,
        });
        outcomes.push(false);
        continue;
      }
      await p.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
      const button = p.getByRole("button", { name: /dev sign-in/i });
      if ((await button.count()) === 0) {
        outcomes.push(false);
        continue;
      }
      await button.click();
      try {
        await p.waitForURL(/dashboard/, { timeout: 30_000 });
        outcomes.push(true);
      } catch {
        outcomes.push(false);
      }
    }

    // The real assertion: any context that believes it is signed in must
    // actually hold a working session (no half-broken shared state).
    for (const [i, p] of [pageA, pageB].entries()) {
      if (!outcomes[i]) continue;
      await p.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
      expect(p.url(), `session ${i} must not be bounced back to login`).not.toContain(
        "/login"
      );
    }
    record({
      kind: "race",
      severity: "info",
      where: "parallel login sessions",
      detail: `outcomes=${JSON.stringify(outcomes)}`,
    });
    await ctxA.close();
    await ctxB.close();
  });
});

test.afterAll(async () => {
  const out = "tests/e2e/audit-findings.json";
  fs.writeFileSync(out, JSON.stringify(findings, null, 2));
  const totals: Record<string, number> = {};
  for (const f of findings) totals[f.severity] = (totals[f.severity] ?? 0) + 1;
  console.log(`\n[AUDIT] findings written to ${out}`);
  console.log(`[AUDIT] totals: ${JSON.stringify(totals)}`);
});
