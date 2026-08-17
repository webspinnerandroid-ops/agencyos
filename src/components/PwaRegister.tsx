"use client";

import { useEffect } from "react";

/**
 * Registers the service worker (offline caching) once the page loads. Only in
 * production — the dev server serves /sw.js through a route that isn't useful
 * during development. A failure (private browsing, unsupported browser) is
 * silently ignored; the app works fine without the SW.
 */
export default function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js")
      .catch((err) => console.warn("[pwa] service worker registration failed:", err));
  }, []);

  return null;
}
