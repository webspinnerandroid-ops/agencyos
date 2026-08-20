import { createServerClient } from "@supabase/ssr"
import { createClient as createServiceRoleClient } from "@supabase/supabase-js"
import { cookies } from "next/headers"

/**
 * Bound fetch for server-side Supabase calls. The VPS's outbound link has
 * flaky periods where connections are dropped (no RST), and undici's default
 * is to wait for the OS TCP timeout (~2 min). Without a bound, any page or
 * route that touches Supabase hangs that long during a blip — nginx then
 * turns it into 504s. 10s is generous for a normal API round-trip.
 */
export function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const timeout = AbortSignal.timeout(10_000);
  const signal = init?.signal
    ? AbortSignal.any([init.signal, timeout])
    : timeout;
  return fetch(input, { ...init, signal });
}

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
        },
      },
      global: { fetch: fetchWithTimeout },
    }
  )
}

export async function createServiceClient() {
  return createServiceRoleClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: fetchWithTimeout },
    }
  )
}
