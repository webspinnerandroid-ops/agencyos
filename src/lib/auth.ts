import { cookies } from "next/headers"
import { verifyAuthValue } from "./auth-signature"

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------
export type UserRole = "super_admin" | "agency_admin" | "agency_editor" | "client"

// ------------------------------------------------------------------
// Helpers: read auth context from cookies set by middleware
// ------------------------------------------------------------------
async function getAuthCookie(name: string): Promise<string | null> {
  const cookieStore = await cookies()
  const raw = cookieStore.get(name)?.value ?? null
  if (!raw) return null
  // Reject forged/tampered cookies — the value must carry a valid HMAC
  // signature minted by the proxy from the verified Supabase session.
  return verifyAuthValue(raw)
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
// getUserId
// Resolves the authenticated Supabase user id from the session cookie
// (the middleware only sets tenant/role/email cookies, not the user id).
// Returns null when there is no valid session.
// ------------------------------------------------------------------
export async function getUserId(): Promise<string | null> {
  try {
    const { createServerClient } = await import("@supabase/ssr");
    const { cookies: nextCookies } = await import("next/headers");
    const cookieStore = await nextCookies();
    const userClient = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll() {},
        },
      }
    );
    const {
      data: { user },
    } = await userClient.auth.getUser();
    return user?.id ?? null;
  } catch {
    return null;
  }
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

// (Removed: `getSupabaseWithTenant`.) It claimed to return a client whose
// queries were "guaranteed to stay within the caller's tenant" through RLS, but
// the policies key on a top-level `tenant_id` JWT claim that no code ever sets —
// see the Multi-Tenant Isolation section of ARCHITECTURE.md. The helper had no
// callers; tenant scope comes from `.eq("tenant_id", await getTenantId())` on a
// service-role client, which `scripts/audit-tenant-scope.cjs` enforces in CI.
