"use client";

import { useEffect, useState } from "react";
import { RefreshCw, X } from "lucide-react";
import { onUpdateReady } from "@/lib/pwa-update";

/**
 * Bottom toast shown when a new service worker has installed (a new deploy).
 * Tapping "Reload" swaps the running bundle in place; "Later" dismisses it.
 * Renders only in the browser, so it's safe on the server.
 */
export default function UpdateToast() {
  const [ready, setReady] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    return onUpdateReady(() => setReady(true));
  }, []);

  if (!ready || dismissed) return null;

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
        onClick={() => {
          setDismissed(true);
          window.location.reload();
        }}
        className="shrink-0 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:opacity-90 transition-opacity"
      >
        Reload
      </button>
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss update notice"
        className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground transition-colors"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
