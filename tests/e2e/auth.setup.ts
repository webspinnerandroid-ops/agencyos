import { test as setup } from "@playwright/test";
import fs from "fs";

/**
 * Audit setup project — ensures exactly one working authenticated session.
 *
 * Order of operations (designed around Supabase's magiclink mint throttle,
 * which rate-limits rapid /api/auth/dev-login calls):
 *
 *   1. If a storage-state file from a previous run exists, revalidate it by
 *      loading it into the browser context and probing /dashboard. Still
 *      authed → done, no new mint needed.
 *   2. Otherwise sign in through the REAL login UI (Dev sign-in button), so
 *      the context holds genuine session cookies. Two attempts with backoff
 *      for the throttle and dev-server compile windows.
 *
 * On failure the marker records authenticated=false and NO storage state is
 * written, so authed suites skip cleanly and the previous run's state can
 * never leak into a fresh checkout.
 */
const AUTH_FILE = "test-results/.audit-auth.json";          // marker + raw cookies (this module's reuse format)
const STORAGE_FILE = "test-results/.audit-auth-storage.json"; // Playwright storageState for the dependent project
const BASE = process.env.AUDIT_BASE_URL ?? "http://localhost:3100";

async function probeAuthed(page: import("@playwright/test").Page): Promise<boolean> {
  try {
    const res = await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2_500);
    const bounced = page.url().includes("/login") || (res?.status() ?? 0) >= 400;
    return !bounced;
  } catch {
    return false;
  }
}

setup("authenticate once", async ({ page }) => {
  setup.setTimeout(240_000);
  let authenticated = false;

  // ---- 1. Reuse a still-valid session from a previous run ---------------
  if (fs.existsSync(AUTH_FILE)) {
    try {
      const saved = JSON.parse(fs.readFileSync(AUTH_FILE, "utf8"));
      if (saved.authenticated && saved.cookies?.length) {
        await page.context().addCookies(saved.cookies);
        authenticated = await probeAuthed(page);
      }
    } catch {
      authenticated = false;
    }
    if (authenticated) {
      console.log("[audit-setup] reused valid session from previous run");
      fs.writeFileSync(
        AUTH_FILE,
        JSON.stringify({ authenticated: true, reused: true, savedAt: new Date().toISOString() })
      );
      return;
    }
  }

  // ---- 2. Fresh sign-in through the real UI ------------------------------
  for (let attempt = 0; attempt < 2 && !authenticated; attempt++) {
    if (attempt > 0) await page.waitForTimeout(30_000);
    const mint = await page.request.post(`${BASE}/api/auth/dev-login`);
    if (mint.status() === 404) break; // disabled — no point retrying
    if (!mint.ok()) continue;
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    const button = page.getByRole("button", { name: /dev sign-in/i });
    if ((await button.count()) === 0) continue;
    await button.click();
    try {
      await page.waitForURL(/dashboard/, { timeout: 60_000 });
      authenticated = true;
    } catch {
      authenticated = false;
    }
  }

  if (authenticated) {
    const cookies = await page.context().cookies(BASE);
    // storageState for the dependent project + raw cookies for our own reuse
    await page.context().storageState({ path: STORAGE_FILE });
    fs.writeFileSync(
      AUTH_FILE,
      JSON.stringify({ authenticated: true, reused: false, cookies, savedAt: new Date().toISOString() })
    );
  } else {
    // Never leave a stale authenticated marker behind.
    try { fs.rmSync(AUTH_FILE, { force: true }); } catch { /* ignore */ }
    fs.writeFileSync(
      "test-results/.audit-auth-missing.json",
      JSON.stringify({ authenticated: false, savedAt: new Date().toISOString() })
    );
    // ALWAYS write the storage-state file: the chromium project declares it
    // as its storageState, and a missing file hard-crashes EVERY test in
    // the project (ENOENT) — including the public ones. An empty state is
    // a normal anonymous session; authed suites self-skip via the marker.
    fs.writeFileSync(STORAGE_FILE, JSON.stringify({ cookies: [], origins: [] }));
    console.log("[audit-setup] could not authenticate — authed suites will skip");
  }
});
