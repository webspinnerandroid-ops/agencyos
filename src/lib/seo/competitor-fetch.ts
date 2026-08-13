// Staged competitor homepage fetch.
//
// Many competitor sites (hotel chains, SaaS vendors) block plain server
// fetches — some on the user-agent alone, others behind Cloudflare/Akamai
// bot management. This walks a fallback ladder so the benchmark scoring gets
// the best chance at real HTML without re-crawling the client's own site:
//
//   1. plain fetch (bot UA)                — cheapest
//   2. browser-like fetch (full Chrome     — gets past UA-only blocks
//      headers + sec-fetch-* hints)
//   3. headless Chromium (puppeteer-core)  — optional; env-gated because it
//      needs a Chrome/Chromium binary on the host (HEADLESS_BROWSER_EXECUTABLE)
//
// Every stage fails safe to null, so callers just mark the competitor as
// uncrawlable when the ladder is exhausted.

import fs from "fs";

const BOT_UA =
  "Mozilla/5.0 (compatible; AgencyOS-SeoAuditor/1.0; +https://agency-os.dev)";
const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const TIMEOUT_MS = 15000;

function browserHeaders(): Record<string, string> {
  return {
    "User-Agent": CHROME_UA,
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "sec-ch-ua": '"Chromium";v="126", "Not/A)Brand";v="8", "Google Chrome";v="126"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "none",
    "sec-fetch-user": "?1",
    "Upgrade-Insecure-Requests": "1",
    "Cache-Control": "max-age=0",
  };
}

async function rawFetch(
  url: string,
  headers: Record<string, string>,
  timeoutMs = TIMEOUT_MS
): Promise<string | null> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers,
      signal: controller.signal,
      redirect: "follow",
    });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** Stage 1 — plain fetch with the legacy bot UA (unchanged behavior). */
async function plainFetch(url: string): Promise<string | null> {
  return rawFetch(url, { "User-Agent": BOT_UA });
}

/** Stage 2 — full browser-like headers; defeats UA-only / naive blocks. */
async function browserLikeFetch(url: string): Promise<string | null> {
  return rawFetch(url, browserHeaders());
}

function findChromeExecutable(): string | null {
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return null;
}

/**
 * Stage 3 — headless Chromium via puppeteer-core. Opt-in only: requires
 * HEADLESS_BROWSER_EXECUTABLE (or HEADLESS_BROWSER_ENABLED=true to
 * auto-discover a system Chrome/Chromium) plus `puppeteer-core` installed.
 * Returns null (never throws) when unavailable, so callers degrade to
 * "uncrawlable".
 */
async function headlessFetch(url: string): Promise<string | null> {
  const explicit = process.env.HEADLESS_BROWSER_EXECUTABLE?.trim();
  const executable =
    explicit ||
    (process.env.HEADLESS_BROWSER_ENABLED === "true"
      ? findChromeExecutable()
      : null);
  if (!executable) return null;

  try {
    const puppeteer = await import("puppeteer-core");
    const browser = await puppeteer.launch({
      executablePath: executable,
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--single-process",
      ],
    });
    try {
      const page = await browser.newPage();
      await page.setUserAgent(CHROME_UA);
      await page.setExtraHTTPHeaders({
        "Accept-Language": "en-US,en;q=0.9",
      });
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 20000,
      });
      // Give lightweight JS challenges (redirects, meta refreshes) a beat.
      await new Promise((r) => setTimeout(r, 1500));
      return await page.content();
    } finally {
      await browser.close().catch(() => {});
    }
  } catch (err) {
    console.warn(
      `[competitor-fetch] headless fallback failed for ${url}:`,
      (err as Error).message
    );
    return null;
  }
}

/**
 * Fetch a competitor homepage HTML through the fallback ladder. Returns null
 * only when every stage failed — callers then mark the competitor uncrawlable.
 */
export async function fetchCompetitorHtml(
  url: string,
  options: { headless?: boolean } = {}
): Promise<string | null> {
  const { headless = true } = options;

  let html = await plainFetch(url);
  if (html) return html;

  html = await browserLikeFetch(url);
  if (html) return html;

  if (headless) {
    html = await headlessFetch(url);
    if (html) return html;
  }

  return null;
}
