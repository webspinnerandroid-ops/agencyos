/**
 * PWA update-available store (client-only).
 *
 * When a new service worker installs (a new deploy), the page is still
 * running the OLD JS/CSS bundle until it reloads. This module lets PwaRegister
 * flag "a new version is ready" and lets the UpdateToast surface it, so the
 * user can tap-to-reload instead of force-closing the PWA.
 */

let updateReady = false;
const listeners = new Set<() => void>();

/** Called from PwaRegister when a new worker is waiting/installed. */
export function markUpdateReady(): void {
  if (updateReady) return;
  updateReady = true;
  emit();
}

export function isUpdateReady(): boolean {
  return updateReady;
}

/** Subscribe to update-availability changes (returns an unsubscribe). */
export function onUpdateReady(cb: () => void): () => void {
  listeners.add(cb);
  cb();
  return () => listeners.delete(cb);
}

function emit(): void {
  for (const cb of listeners) cb();
}
