"use client";

import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  isInstallAvailable,
  isIosSafari,
  onInstallAvailable,
  promptInstall,
} from "@/lib/pwa-install";

/**
 * Landing-page install banner. On Android/desktop it appears when the browser
 * offers a PWA install prompt (captured via beforeinstallprompt) and lets the
 * user trigger it on demand; on iOS Safari, where no such prompt API exists,
 * it shows the Add-to-Home-Screen instructions instead. Dismissible.
 */
export default function InstallPromptBanner() {
  const [available, setAvailable] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => onInstallAvailable(setAvailable), []);

  // iOS has no beforeinstallprompt — show the hint regardless.
  if (dismissed || (!available && !isIosSafari())) return null;

  return (
    <div className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2 flex items-center justify-between gap-3">
        <p className="text-sm text-foreground/90">
          <Download className="inline size-4 mr-1.5 text-primary align-[-2px]" />
          {isIosSafari()
            ? "Install this app on your phone: tap Share → Add to Home Screen."
            : "Install Agency OS on your device for offline access and notifications."}
        </p>
        <div className="flex items-center gap-2 shrink-0">
          {!isIosSafari() && (
            <Button
              size="sm"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void promptInstall().finally(() => setBusy(false));
              }}
            >
              Install
            </Button>
          )}
          <button
            onClick={() => setDismissed(true)}
            aria-label="Dismiss install banner"
            className="rounded-md p-1 hover:bg-muted transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
