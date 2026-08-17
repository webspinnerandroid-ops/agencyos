// ============================================================================
// Agency OS service worker — offline support.
//
// Strategy:
//   - Precache the static app shell (manifest, icons, the Next.js asset
//     bundles) on install so the app still opens with no network.
//   - Static assets: cache-first with a background refresh.
//   - Navigations (HTML pages): network-first, falling back to a cached copy
//     and finally to a simple offline splash when nothing is cached.
//   - API calls (fetch to /api/): never cached — they need live data.
//
// New deploys bump __VERSION__, which invalidates the old cache in `activate`.
// ============================================================================

const VERSION = "v1";
const STATIC_CACHE = `agencyos-static-${VERSION}`;
const PAGE_CACHE = `agencyos-pages-${VERSION}`;

// Core shell cached on install — anything else is cached on first use.
const PRECACHE = [
  "/",
  "/manifest.json",
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                key.startsWith("agencyos-") &&
                key !== STATIC_CACHE &&
                key !== PAGE_CACHE
            )
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Same-origin only — never intercept cross-origin requests (fonts, APIs,
  // Supabase, Bunny CDN, Stripe, etc.).
  if (url.origin !== self.location.origin) return;

  // Never cache API/route-handler responses — they must stay live.
  if (url.pathname.startsWith("/api/")) return;

  // HTML page navigations: network-first with an offline fallback.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(PAGE_CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          const fallback = await caches.match("/");
          return (
            fallback ||
            new Response("<h1>You're offline</h1><p>Reconnect to continue.</p>", {
              headers: { "Content-Type": "text/html; charset=utf-8" },
            })
          );
        })
    );
    return;
  }

  // Static assets (js/css/images/fonts): cache-first with background refresh.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
