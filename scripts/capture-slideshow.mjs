// ============================================================================
// Capture sales-site screenshots with ZERO dependencies.
//
// Two phases:
//  1. Seed: a short CDP session (Network.setCookie, no 4096-byte
//     document.cookie limit) writes the session cookies into a fresh Chrome
//     profile's cookie store.
//  2. Capture: headless Chrome's battle-tested `--screenshot` CLI path
//     (CDP Page.captureScreenshot hangs on this machine's Chrome 150 /
//     Windows combo) reuses that profile, so authenticated pages render.
//
// Usage: node scripts/capture-slideshow.mjs
//
// The cookie file (scripts/.session-cookies.json) is gitignored — regenerate
// it from the preview (document.cookie) whenever the session expires.
// ============================================================================

import { spawn, spawnSync } from "node:child_process";
import { writeFileSync, existsSync, readFileSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT_DIR = join(ROOT, "public", "screenshots");
const COOKIE_FILE = join(__dirname, ".session-cookies.json");
const CHROME =
  process.env.CHROME_PATH ||
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = "http://localhost:49686";
const PORT = 9333;
const PROFILE = join(ROOT, ".shot-profile");

const SLIDES = [
  { file: "slide-hero.png", path: "/", budget: 15000, auth: false },
  { file: "slide-dashboard.png", path: "/dashboard", budget: 25000, auth: true },
  { file: "slide-generate.png", path: "/dashboard/generate", budget: 25000, auth: true },
  { file: "slide-images.png", path: "/dashboard/generate-images", budget: 25000, auth: true },
  { file: "slide-ai-team.png", path: "/dashboard/ai-team", budget: 25000, auth: true },
  { file: "slide-chat.png", path: "/dashboard/ai-team/chat", budget: 30000, auth: true },
  { file: "slide-calendar.png", path: "/dashboard/calendar", budget: 25000, auth: true },
  { file: "slide-seo.png", path: "/dashboard/seo", budget: 25000, auth: true },
];

mkdirSync(OUT_DIR, { recursive: true });

if (!existsSync(COOKIE_FILE)) {
  console.error(
    "Missing scripts/.session-cookies.json — copy the preview's document.cookie string there first."
  );
  process.exit(1);
}
const COOKIE_STRING = JSON.parse(readFileSync(COOKIE_FILE, "utf8")).cookie;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Kill a Chrome process tree (chrome.kill() only kills the parent, leaving
// renderers that hold the profile lock).
function killTree(pid) {
  try {
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
  } catch {}
}

function parseCookies() {
  const out = [];
  for (const pair of COOKIE_STRING.split("; ")) {
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    out.push({ name: pair.slice(0, eq).trim(), value: pair.slice(eq + 1).trim() });
  }
  return out.filter((c) => c.name && c.value);
}

// ---- Phase 1: seed the profile's cookie store via CDP ----------------------
async function seedProfile() {
  rmSync(PROFILE, { recursive: true, force: true });
  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${PROFILE}`,
      "about:blank",
    ],
    { stdio: "ignore" }
  );

  let target;
  for (let i = 0; i < 40 && !target; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      if (res.ok) {
        const list = await res.json();
        // Pick the real page target — /json/list can lead with background pages.
        target = list.find((t) => t.type === "page") || list[0];
      }
    } catch {}
    if (!target) await sleep(500);
  }
  if (!target) throw new Error("Chrome debugger did not come up");

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let id = 0;
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  });
  await new Promise((res, rej) => {
    ws.addEventListener("open", res);
    ws.addEventListener("error", rej);
  });
  const cmd = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const myId = ++id;
      ws.send(JSON.stringify({ id: myId, method, params }));
      pending.set(myId, { resolve, reject });
    });

  try {
    await cmd("Network.enable");
    const expires = Math.floor(Date.now() / 1000) + 3600;
    for (const c of parseCookies()) {
      await cmd("Network.setCookie", {
        name: c.name,
        value: c.value,
        url: BASE,
        path: "/",
        expires,
      });
    }
    await cmd("Page.enable");
    await cmd("Page.navigate", { url: BASE + "/" });
    await sleep(2500);
    console.log("Seeded", parseCookies().length, "cookies into profile");
  } finally {
    // Graceful close so the cookie store flushes to disk.
    try {
      await cmd("Browser.close");
    } catch {
      killTree(chrome.pid);
    }
    try { ws.close(); } catch {}
    const exited = await new Promise((resolve) => {
      const t = setTimeout(() => {
        killTree(chrome.pid);
        resolve(false);
      }, 8000);
      chrome.on("exit", () => {
        clearTimeout(t);
        resolve(true);
      });
    });
    if (!exited) console.log("  seed chrome force-killed");
    await sleep(1000);
  }
}

// ---- Phase 2: CLI screenshots reusing the seeded profile -------------------
async function capture(slide) {
  const png = join(OUT_DIR, slide.file);
  const args = [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--hide-scrollbars",
    "--window-size=1920,1080",
    `--virtual-time-budget=${slide.budget}`,
    `--user-data-dir=${PROFILE}`,
    `--screenshot=${png}`,
    BASE + slide.path,
  ];
  console.log("capturing", slide.file, "->", slide.path);
  const chrome = spawn(CHROME, args);
  let out = "";
  chrome.stdout?.on("data", (d) => (out += d));
  chrome.stderr?.on("data", (d) => (out += d));
  const exit = await new Promise((resolve) => {
    const killer = setTimeout(() => {
      try { chrome.kill(); } catch {}
      resolve("timeout");
    }, 90000);
    chrome.on("exit", (code) => {
      clearTimeout(killer);
      resolve("exit:" + code);
    });
  });
  if (exit !== "exit:0") console.log("  chrome finished with", exit);
  if (existsSync(png)) {
    const size = readFileSync(png).length;
    console.log("  saved", slide.file, `(${Math.round(size / 1024)} KB)`);
    return size;
  }
  console.log("  chrome output:", out.trim().slice(0, 400));
  console.log("  MISSING", slide.file);
  return 0;
}

try {
  await seedProfile();
} catch (e) {
  console.error("Seed failed:", e.message);
  process.exit(1);
}

let ok = 0;
const missing = [];
for (const slide of SLIDES) {
  try {
    const size = await capture(slide);
    if (size > 5000) ok++;
    else missing.push(slide.file + (size ? " (tiny)" : " (missing)"));
  } catch (e) {
    console.error("  ERROR", slide.file, e.message);
    missing.push(slide.file);
  }
}
rmSync(PROFILE, { recursive: true, force: true });
console.log(`\n${ok}/${SLIDES.length} slides captured.`);
if (missing.length) console.log("Problems:", missing.join(", "));
