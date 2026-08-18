/**
 * PWA install-prompt store (client-only).
 *
 * The browser only auto-shows its native install prompt under narrow,
 * timing-dependent criteria — so once it's gone it tends to stay gone. This
 * module captures the `beforeinstallprompt` event when it DOES fire and holds
 * it, letting the UI offer an explicit "Install app" button that re-surfaces
 * the prompt on demand. `appinstalled` clears the state so the button
 * disappears after install.
 *
 * iOS Safari has no `beforeinstallprompt` at all — components should use
 * `isIosSafari()` to show "Add to Home Screen" instructions instead.
 */

type DeferredPrompt = {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let deferred: DeferredPrompt | null = null;
const listeners = new Set<(available: boolean) => void>();

/** Called from the window `beforeinstallprompt` listener (PwaRegister). */
export function captureInstallPrompt(e: Event): void {
  e.preventDefault();
  deferred = e as unknown as DeferredPrompt;
  emit();
}

/** Called from the window `appinstalled` listener — the button can go away. */
export function markInstalled(): void {
  deferred = null;
  emit();
}

export function isInstallAvailable(): boolean {
  return deferred !== null;
}

export function getInstallPrompt(): DeferredPrompt | null {
  return deferred;
}

/** Re-surface the captured prompt. Clears the store on accept OR dismiss. */
export async function promptInstall(): Promise<boolean> {
  const p = deferred;
  if (!p) return false;
  try {
    await p.prompt();
    const choice = await p.userChoice;
    return choice.outcome === "accepted";
  } finally {
    deferred = null;
    emit();
  }
}

/** Subscribe to install-availability changes (returns an unsubscribe). */
export function onInstallAvailable(cb: (available: boolean) => void): () => void {
  listeners.add(cb);
  cb(isInstallAvailable());
  return () => listeners.delete(cb);
}

function emit(): void {
  for (const cb of listeners) cb(isInstallAvailable());
}

/** True on iOS Safari where the native install prompt can never fire. */
export function isIosSafari(): boolean {
  return (
    typeof navigator !== "undefined" &&
    /iphone|ipad|ipod/i.test(navigator.userAgent)
  );
}
