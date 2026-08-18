"use client";

import { useEffect } from "react";
import { captureInstallPrompt, markInstalled } from "@/lib/pwa-install";

/**
 * Registers the service worker (offline caching) once the page loads, then —
 * when the user grants notification permission — sets up web push so the
 * system/employees can notify the device with a badge on the app icon.
 *
 * Only in production: the dev server serves /sw.js through a route that isn't
 * useful during development, and push requires a secure, deployed origin.
 * Every failure is silently ignored; the app works fine without push.
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  // The VAPID key arrives base64url; back-pad to standard base64.
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function bufToBase64url(buf: ArrayBuffer | null): string {
  if (!buf) return "";
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function setupPush(registration: ServiceWorkerRegistration): Promise<void> {
  try {
    if (!("PushManager" in window)) return;
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return;

    const res = await fetch("/api/push/vapid-key", { credentials: "include" });
    if (!res.ok) return;
    const { key } = (await res.json()) as { key?: string };
    if (!key) return;

    const existing = await registration.pushManager.getSubscription();
    const subscription =
      existing ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      }));

    await fetch("/api/push/subscribe", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        endpoint: subscription.endpoint,
        keys: {
          p256dh: bufToBase64url(subscription.getKey("p256dh")),
          auth: bufToBase64url(subscription.getKey("auth")),
        },
      }),
    });
  } catch (err) {
    console.warn("[pwa] push setup failed:", err);
  }
}

export default function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;

    // Capture the browser's install prompt the moment it fires so the UI can
    // offer an explicit "Install app" button (the native prompt rarely
    // re-appears on its own once dismissed).
    const onBeforeInstall = (e: Event) => captureInstallPrompt(e);
    const onInstalled = () => markInstalled();
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);

    if (!("serviceWorker" in navigator)) return;

    const cleanup = () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };

    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        // Live badge on the app icon: the service worker pings us with the
        // unread count when a push arrives.
        navigator.serviceWorker.addEventListener("message", (event) => {
          const data = event.data as { type?: string; count?: number } | null;
          if (data?.type === "AGENCYOS_PUSH" && "setAppBadge" in navigator) {
            try {
              void navigator.setAppBadge(data.count ?? 0);
            } catch {
              // badge unsupported on this platform
            }
          }
        });
        if ("Notification" in window) {
          void setupPush(reg);
        }
      })
      .catch((err) => console.warn("[pwa] service worker registration failed:", err));

    return cleanup;
  }, []);

  return null;
}