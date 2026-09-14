import { defineConfig } from "@playwright/test";

/**
 * Playwright config for the technical & security audit suite
 * (tests/e2e/app-technical-audit.spec.ts).
 *
 * Targets the local dev server. Tests are not parallelized on purpose: the
 * audit measures per-flow latencies and logs server-side noise, and one of
 * the suites intentionally generates concurrent load itself.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.AUDIT_BASE_URL ?? "http://localhost:3100",
    headless: true,
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true,
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
  },
  projects: [
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: "chromium",
      use: {
        browserName: "chromium",
        storageState: "test-results/.audit-auth-storage.json",
      },
      dependencies: ["setup"],
    },
  ],
});
