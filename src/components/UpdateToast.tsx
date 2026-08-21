"use client";

import { useEffect, useState } from "react";
import { RefreshCw, X } from "lucide-react";
import { onUpdateReady } from "@/lib/pwa-update";

/**
 * Bottom toast shown when a new service worker has installed (a new deploy).
 *
 * Version-aware: it only appears when the DEVICE is actually running an older
 * build than the server. A device already on the newest version never sees
 * it — the running bundle version (baked at build time) is compared against
 * the live /api/version on every page load, and the toast is suppressed when
 * they match or when it was already dismissed for that version (localStorage).
 *
 * Tapping "Reload" swaps the running bundle in place; "Later" dismisses it.
 * Renders only in the browser, so it's safe on the server.
 */

const DISMISS_KEY = "agencyos-update-dismissed";
const RUNNING_VERSION =
  (typeof process !== "undefined" && (process.env.NEXT_PUBLIC_BUILD_SHA as string | undefined)) ||
  "";

export default function UpdateToast() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const consider = () => {
      // The device's own bundle is the ground truth: if it already matches
      // the live version, this page is current — never nag.
      fetch("/api/version", { credentials: "include" })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          const live = typeof data?.version === "string" ? data.version : "";
          if (!live) return;
          if (live === RUNNING_VERSION) return;
          // Suppress if the user already dismissed this exact version.
          if (localStorage.getItem(DISMISS_KEY) === live) return;
          setVisible(true);
        })
        .catch(() => {});
    };
    return onUpdateReady(consider);
  }, []);

  if (!visible) return null;

  const dismiss = (reload: boolean) => {
    fetch("/api/version", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && typeof data.version === "string") {
          localStorage.setItem(DISMISS_KEY, data.version);
        }
      })
      .catch(() => {});
    if (reload) window.location.reload();
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-4 bottom-4 z-[100] mx-auto flex max-w-sm items-center gap-3 rounded-lg border bg-popover px-4 py-3 shadow-lg"
      style={{
        backgroundColor: "var(--popover, hsl(0 0% 100%))",
        color: "var(--popover-foreground, hsl(0 0% 10%))",
      }}
    >
      <RefreshCw className="size-4 shrink-0 text-primary" />
      <div className="flex-1 text-sm">
        <span className="font-medium">Update available</span>
        <span className="text-muted-foreground"> — reload to get the latest version.</span>
      </div>
      <button
        onClick={() => dismiss(true)}
        className="shrink-0 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:opacity-90 transition-opacity"
      >
        Reload
      </button>
      <button
        onClick={() => dismiss(false)}
        aria-label="Dismiss update notice"
        className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground transition-colors"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
