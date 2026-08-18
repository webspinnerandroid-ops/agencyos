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

const VERSION = "v3";
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

// ============================================================================
// Web push — PWA notifications.
//
// The server sends an EMPTY push; on receipt we fetch /api/push/pending
// (same-origin fetch carries the session cookie, so auth works exactly like
// a normal page request) and show the latest unread notifications with a
// link. Tapping a notification opens the linked page in the app.
// ============================================================================

self.addEventListener("push", (event) => {
  if (!("Notification" in self) || self.Notification.permission !== "granted") {
    return;
  }
  event.waitUntil(
    fetch("/api/push/pending", { credentials: "same-origin" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!data || !Array.isArray(data.items) || data.items.length === 0) {
          return;
        }
        const first = data.items[0];
        const options = {
          body: first.body || "",
          icon: "/icon-192.png",
          badge: "/icon-192.png",
          tag: "agencyos-push",
          data: { url: first.link || "/dashboard" },
        };
        self.registration.showNotification(
          data.count > 1
            ? `${data.count} notifications from your team`
            : first.title || "New notification",
          options
        );
        // Tell any open page to refresh the bell and the app-icon badge.
        self.clients.matchAll({ includeUncontrolled: true }).then((clients) => {
          clients.forEach((client) =>
            client.postMessage({ type: "AGENCYOS_PUSH", count: data.count })
          );
        });
      })
      .catch(() => {
        // Session expired or network off — nothing to show.
      })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target =
    (event.notification.data && event.notification.data.url) || "/dashboard";
  const url = new URL(target, self.location.origin).href;
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          if ("navigate" in client) {
            return client.navigate(url).then(() => client.focus());
          }
        }
        return self.clients.openWindow(url);
      })
  );
});

// Clear the app-icon badge once the user opens the app and the bell counts
// zero unread — the page drives that from its own unread fetch.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "AGENCYOS_BADGE_CLEAR") {
    self.clients.matchAll({ type: "window" }).then(() => {
      // Nothing to do here — setAppBadge lives on the window.
    });
  }
});
