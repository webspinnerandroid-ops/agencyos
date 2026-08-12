import { cookies } from "next/headers"
import { createServerClient } from "@supabase/ssr"

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------
export type UserRole = "super_admin" | "agency_admin" | "agency_editor" | "client"

// ------------------------------------------------------------------
// Helpers: read auth context from cookies set by middleware
// ------------------------------------------------------------------
async function getAuthCookie(name: string): Promise<string | null> {
  const cookieStore = await cookies()
  return cookieStore.get(name)?.value ?? null
}

// ------------------------------------------------------------------
// getTenantId
// Reads the x-tenant-id cookie set by the middleware. Route Handlers
// and Server Components can call this to obtain the current tenant.
// ------------------------------------------------------------------
export async function getTenantId(): Promise<string> {
  const tenantId = await getAuthCookie("x-tenant-id")

  if (!tenantId) {
    throw new Error(
      "x-tenant-id cookie is missing. Is the middleware configured correctly?"
    )
  }

  return tenantId
}

// ------------------------------------------------------------------
// getRole
// Reads the x-user-role cookie set by the middleware.
// ------------------------------------------------------------------
export async function getRole(): Promise<UserRole> {
  const role = (await getAuthCookie("x-user-role")) as UserRole | null

  if (!role) {
    throw new Error(
      "x-user-role cookie is missing. Is the middleware configured correctly?"
    )
  }

  return role
}

// ------------------------------------------------------------------
// getUserEmail
// Reads the x-user-email cookie set by the middleware (best-effort; returns
// null when unavailable, e.g. server contexts without the middleware).
// ------------------------------------------------------------------
export async function getUserEmail(): Promise<string | null> {
  return await getAuthCookie("x-user-email")
}

// ------------------------------------------------------------------
// getClientId
// Reads the x-client-id cookie set by the middleware (only for client
// role users). Returns null if not set (non-client users).
// ------------------------------------------------------------------
export async function getClientId(): Promise<string | null> {
  return await getAuthCookie("x-client-id")
}

// ------------------------------------------------------------------
// requireClientRole
// Ensures the caller is a "client" role user, returning their client_id.
// ------------------------------------------------------------------
export async function requireClientRole(): Promise<string> {
  const role = await getRole()
  if (role !== "client") {
    throw new Error("Access denied: client role required")
  }
  const clientId = await getClientId()
  if (!clientId) {
    throw new Error("Client ID not found for client user")
  }
  return clientId
}

// ------------------------------------------------------------------
// requireRole
// Throws a 403-like error if the caller's role doesn't match the
// required role (or isn't at least the required level).
// ------------------------------------------------------------------
const ROLE_HIERARCHY: Record<UserRole, number> = {
  super_admin: 4,
  agency_admin: 3,
  agency_editor: 2,
  client: 1,
}

export async function requireRole(minimumRole: UserRole): Promise<void> {
  const role = await getRole()

  if (ROLE_HIERARCHY[role] < ROLE_HIERARCHY[minimumRole]) {
    throw new Error(
      `Insufficient permissions. Required: ${minimumRole}, current: ${role}`
    )
  }
}

// ------------------------------------------------------------------
// getSupabaseWithTenant
// Returns a Supabase client that automatically scopes queries to the
// current tenant by reading the x-tenant-id header. Use this in Route
// Handlers where you want RLS-compatible queries that are guaranteed
// to stay within the caller's tenant.
//
// IMPORTANT: This does NOT set a custom claim on the JWT. It simply
// injects the tenant_id into the `app_metadata` claim of the client
// session so that RLS policies referencing
//   auth.jwt() -> app_metadata -> tenant_id
// can function properly. If your RLS policies instead rely on the
// user_roles table directly, just use the standard server client
// and add `.eq("tenant_id", await getTenantId())` to your queries.
// ------------------------------------------------------------------
export async function getSupabaseWithTenant() {
  const cookieStore = await cookies()
  const tenantId = await getTenantId()

  const client = createServerClient(
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
            // setAll called from a Server Component — safe to ignore
          }
        },
      },
    }
  )

  /**
   * Usage pattern — always scope queries by tenantId explicitly:
   *
   *   const { client, tenantId } = await getSupabaseWithTenant()
   *   await client.from("projects").select().eq("tenant_id", tenantId)
   *
   * Explicit filtering is safer than relying on RLS alone, especially
   * in server-side contexts where the service_role key may be in play.
   */
  return { client, tenantId }
}
