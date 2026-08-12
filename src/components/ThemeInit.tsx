"use client";

import { useEffect } from "react";

/**
 * Applies the persisted light/dark theme on every full page load.
 *
 * ThemeToggle (in the dashboard header) toggles and persists the choice, but
 * it only mounts inside the dashboard layout — pages rendered outside it
 * (e.g. /help, /login, the landing page) would otherwise fall back to light
 * mode on a hard navigation because the server-rendered <html> has no `.dark`
 * class. This lives in the root layout so the stored theme is re-applied
 * wherever the user lands.
 */
export default function ThemeInit() {
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem("theme");
    } catch {
      // ignore
    }
    const prefersDark = window.matchMedia(
      "(prefers-color-scheme: dark)"
    ).matches;
    const isDark = stored ? stored === "dark" : prefersDark;
    document.documentElement.classList.toggle("dark", isDark);
  }, []);

  return null;
}
