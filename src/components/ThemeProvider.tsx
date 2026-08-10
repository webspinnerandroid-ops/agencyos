"use client"

import { useEffect } from "react"

/**
 * Decodes a base64url-encoded JSON string into a TenantTheme-like object.
 * This is a lightweight browser-side copy so we avoid importing Node-only
 * modules (Buffer) in a "use client" component.
 */
interface TenantTheme {
  tenantId: string
  name: string | null
  slug: string | null
  logoUrl: string | null
  primaryColor: string | null
  customDomain: string | null
}

function decodeFromCookie(encoded: string): TenantTheme | null {
  try {
    // Decode base64url → string
    const json = atob(encoded.replace(/-/g, "+").replace(/_/g, "/"))
    const parsed = JSON.parse(json) as TenantTheme
    if (!parsed?.tenantId) return null
    return parsed
  } catch {
    return null
  }
}

/**
 * Reads a cookie by name. Lightweight helper so we don't need a dependency
 * like js-cookie just for one read.
 */
function getCookie(name: string): string | null {
  if (typeof document === "undefined") return null
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}

/**
 * Converts a hex color string (e.g. "#3b82f6") to oklch for use as a CSS
 * primary variable. We expose the raw primaryColor as a custom property too,
 * but we also derive a few variants (hover, foreground) so components "just
 * work" when using semantic tokens.
 *
 * For a real project you'd want a proper hex→oklch conversion. Here we use
 * a pragmatic approach: set the raw hex on --tenant-primary and let the
 * shadcn Tailwind theme inherit from that where possible. The key CSS
 * variables we override are:
 *   --primary          → tenant primary (as oklch fallback or raw hex)
 *   --primary-foreground → #fff (for most brand colours)
 *   --ring             → tenant primary at lower opacity
 *
 * Components that reference var(--primary) via Tailwind's `bg-primary` etc.
 * will automatically reflect the tenant's brand.
 */
function hexToOklchFallback(hex: string): string {
  // We simply pass-through the hex — modern browsers handle hex variables in
  // conjunction with oklch-contextual tokens fine. The :root override sets
  // --primary to the hex directly, so bg-primary etc. all pick it up.
  return hex
}

export default function ThemeProvider() {
  useEffect(() => {
    const raw = getCookie("x-tenant-theme")
    if (!raw) return

    const theme = decodeFromCookie(raw)
    if (!theme) return

    const root = document.documentElement

    // Apply tenant brand as the primary color
    if (theme.primaryColor) {
      root.style.setProperty("--tenant-primary", theme.primaryColor)
      root.style.setProperty("--primary", theme.primaryColor)
      root.style.setProperty("--primary-foreground", "#ffffff")
    }

    // Subtle ring colour from the primary
    if (theme.primaryColor) {
      root.style.setProperty("--tenant-primary-ring", `${theme.primaryColor}80`)
      root.style.setProperty("--ring", `${theme.primaryColor}80`)
    }
  }, [])

  return null
}