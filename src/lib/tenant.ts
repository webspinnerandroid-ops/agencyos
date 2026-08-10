import { cache } from "react"
import { createServiceClient } from "@/lib/supabase/server"

/**
 * Tenant theme settings returned by the cached fetcher.
 */
export interface TenantTheme {
  tenantId: string
  name: string | null
  slug: string | null
  logoUrl: string | null
  primaryColor: string | null
  customDomain: string | null
}

/**
 * Serialised form of the tenant theme, suitable for embedding as a cookie or
 * request header value (JSON-serialised + base64url-encoded so it stays
 * compact and url-safe).
 */
export function encodeTenantTheme(theme: TenantTheme): string {
  const json = JSON.stringify(theme)
  return Buffer.from(json, "utf-8").toString("base64url")
}

/**
 * Reverse of encodeTenantTheme — parses a base64url-encoded JSON string
 * back into a TenantTheme object. Returns null on failure.
 */
export function decodeTenantTheme(encoded: string): TenantTheme | null {
  try {
    const json = Buffer.from(encoded, "base64url").toString("utf-8")
    const parsed = JSON.parse(json) as TenantTheme
    if (!parsed?.tenantId) return null
    return parsed
  } catch {
    return null
  }
}

/**
 * Cached reader for tenant settings.
 *
 * Uses React.cache() so within a single render pass the same tenant's data
 * is fetched only once, even when called from multiple components or
 * layouts. The underlying Supabase client uses the service_role key so
 * RLS is bypassed — only call this from server-side code.
 */
export const getTenantTheme = cache(
  async (tenantId: string): Promise<TenantTheme> => {
    const supabase = await createServiceClient()

    const { data } = await supabase
      .from("tenants")
      .select("name, slug, logo_url, primary_color, custom_domain")
      .eq("id", tenantId)
      .single()

    return {
      tenantId,
      name: data?.name ?? null,
      slug: data?.slug ?? null,
      logoUrl: data?.logo_url ?? null,
      primaryColor: data?.primary_color ?? "#2563eb",
      customDomain: data?.custom_domain ?? null,
    }
  }
)

/**
 * Like getTenantTheme but wraps errors in a try/catch and returns a
 * safe fallback instead of throwing, which is useful in middleware
 * where we don't want to block the request on a DB hiccup.
 */
export async function getTenantThemeSafe(
  tenantId: string
): Promise<TenantTheme> {
  try {
    return await getTenantTheme(tenantId)
  } catch {
    return {
      tenantId,
      name: null,
      slug: null,
      logoUrl: null,
      primaryColor: "#2563eb",
      customDomain: null,
    }
  }
}