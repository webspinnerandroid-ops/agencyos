import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { getTenantThemeSafe, encodeTenantTheme } from "@/lib/tenant"

const PUBLIC_ROUTES = ["/login", "/register", "/forgot-password", "/reset-password", "/pending-approval", "/help", "/about", "/contact", "/privacy", "/terms", "/api/webhooks", "/api/auth/callback", "/api/register", "/api/inngest", "/_next", "/favicon.ico", "/robots.txt", "/sitemap.xml", "/og-image.png", "/"]

function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(route + "/")
  )
}

/**
 * Next.js server actions POST with a `Next-Action` header. If middleware
 * redirects one of those to /login (a plain HTML redirect), the browser's
 * fetchServerAction throws "An unexpected response was received from the
 * server" (unhandledRejection). For server actions, return a clean 401 JSON
 * instead so the client handles the failure gracefully.
 */
function isServerAction(request: NextRequest): boolean {
  return !!request.headers.get("next-action")
}

function authFailureResponse(request: NextRequest) {
  if (isServerAction(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const loginUrl = request.nextUrl.clone()
  loginUrl.pathname = "/login"
  loginUrl.searchParams.set("redirect", request.nextUrl.pathname)
  return NextResponse.redirect(loginUrl)
}

// ---------------------------------------------------------------------------
// Short-lived in-memory caches.
// Middleware here runs in the Node.js runtime (it already uses Buffer), so a
// module-level Map persists across requests in the same process. Entry keys:
//  - auth: the raw Supabase access-token cookie value. Sessions rotate their
//    token on refresh, so stale entries naturally age out and re-verify.
//  - theme: tenant id (themes change rarely, so 5 min staleness is fine).
// ---------------------------------------------------------------------------
interface AuthContext {
  userId: string
  email: string
  tenantId: string
  role: string
  clientId: string | null
}

const AUTH_TTL_MS = 60_000
/** null value = authenticated user with no role row (redirect to pending-approval) */
const authCache = new Map<string, { value: AuthContext | null; expiresAt: number }>()

const THEME_TTL_MS = 5 * 60_000
const themeCache = new Map<string, { value: string; expiresAt: number }>()

const WORKSPACE_TTL_MS = 5 * 60_000
/** null value = tenant has no default workspace yet */
const workspaceCache = new Map<string, { value: string | null; expiresAt: number }>()

function cacheGet<T>(
  cache: Map<string, { value: T; expiresAt: number }>,
  key: string
): T | undefined {
  const hit = cache.get(key)
  if (hit && hit.expiresAt > Date.now()) return hit.value
  if (hit) cache.delete(key)
  return undefined
}

function cacheSet<T>(
  cache: Map<string, { value: T; expiresAt: number }>,
  key: string,
  value: T,
  ttlMs: number
) {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs })
  // Opportunistic pruning so the maps never grow unbounded.
  if (cache.size > 1000) {
    const now = Date.now()
    for (const [k, v] of cache) {
      if (v.expiresAt <= now) cache.delete(k)
    }
  }
}

/** Find the Supabase auth-token cookie dynamically (supports any project ref + chunked cookies) */
function findSupabaseAccessToken(request: NextRequest): string | undefined {
  const candidates: string[] = []
  const chunked: Map<string, string[]> = new Map()

  for (const cookie of request.cookies.getAll()) {
    // Supabase auth token: sb-{project-ref}-auth-token
    if (cookie.name.match(/^sb-.+-auth-token$/)) {
      candidates.push(cookie.value)
    }
    // Cookie chunking: sb-{project-ref}-auth-token.{0,1,2,...}
    const chunkMatch = cookie.name.match(/^(sb-.+-auth-token)\.(\d+)$/)
    if (chunkMatch) {
      const base = chunkMatch[1]
      const idx = parseInt(chunkMatch[2], 10)
      if (!chunked.has(base)) chunked.set(base, [])
      chunked.get(base)![idx] = cookie.value
    }
  }

  // Reassemble chunked cookies
  for (const [base, parts] of chunked) {
    const assembled = parts.filter(Boolean).join("")
    if (assembled) candidates.push(assembled)
  }

  return candidates[0]
}

export default async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (isPublicRoute(pathname)) {
    return NextResponse.next()
  }

  const accessToken = findSupabaseAccessToken(request)

  if (!accessToken) {
    return authFailureResponse(request)
  }

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  // Extract the token from the cookie. Supabase may store it as:
  // - Raw JSON array: [access_token, refresh_token, ...]
  // - base64-prefixed: "base64-<base64_encoded_json>"
  let token: string
  try {
    const raw = accessToken.startsWith("base64-")
      ? Buffer.from(accessToken.slice("base64-".length), "base64").toString("utf-8")
      : decodeURIComponent(accessToken)
    const parsed = JSON.parse(raw)
    token = Array.isArray(parsed) ? parsed[0] : parsed.access_token ?? accessToken
  } catch {
    token = accessToken
  }

  // Cached auth context? Keyed by the raw cookie so a refreshed session (new
  // token) re-verifies instead of reusing a stale entry.
  let auth = cacheGet(authCache, accessToken)

  if (auth === undefined) {
    // Verify the user
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token)

    if (userError || !user) {
      return authFailureResponse(request)
    }

    const { data: userRole } = await supabaseAdmin
      .from("user_roles")
      .select("tenant_id, role, client_id")
      .eq("user_id", user.id)
      .single()

    if (!userRole) {
      cacheSet(authCache, accessToken, null, AUTH_TTL_MS)
      const pendingUrl = request.nextUrl.clone()
      pendingUrl.pathname = "/pending-approval"
      return NextResponse.redirect(pendingUrl)
    }

    auth = {
      userId: user.id,
      email: user.email ?? "",
      tenantId: userRole.tenant_id,
      role: userRole.role,
      clientId: userRole.client_id ?? null,
    }
    cacheSet(authCache, accessToken, auth, AUTH_TTL_MS)
  } else if (auth === null) {
    const pendingUrl = request.nextUrl.clone()
    pendingUrl.pathname = "/pending-approval"
    return NextResponse.redirect(pendingUrl)
  }

  // Tenant theme (cached per tenant; re-fetched at most once per 5 min)
  let encoded = cacheGet(themeCache, auth.tenantId)
  if (encoded === undefined) {
    const tenantTheme = await getTenantThemeSafe(auth.tenantId)
    encoded = encodeTenantTheme(tenantTheme)
    cacheSet(themeCache, auth.tenantId, encoded, THEME_TTL_MS)
  }

  const response = NextResponse.next()

  // Pass auth context via cookies so route handlers can read them reliably.
  // Using request headers via NextResponse.next({ request: { headers } })
  // causes type mismatches and crashes in Next.js 16.
  const cookieOptions = {
    httpOnly: false,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 60 * 24,
  }

  response.cookies.set("x-tenant-id", auth.tenantId, cookieOptions)
  response.cookies.set("x-user-role", auth.role, cookieOptions)
  response.cookies.set("x-user-id", auth.userId, cookieOptions)
  response.cookies.set("x-user-email", auth.email, cookieOptions)
  if (auth.clientId) {
    response.cookies.set("x-client-id", auth.clientId, cookieOptions)
  }
  response.cookies.set("x-tenant-theme", encoded, {
    ...cookieOptions,
    httpOnly: false,
  })

  // Default workspace (cached per tenant). Setting the `workspace_id` cookie
  // here means getCurrentWorkspaceId() in pages/actions hits the cookie path
  // instead of doing a DB query per page render (the fallback that caused
  // slow first-loads). Only set it when the request doesn't already carry a
  // workspace_id cookie (i.e. no explicit selection yet) so a user's chosen
  // workspace from WorkspaceSelector is never clobbered.
  if (!request.cookies.get("workspace_id")?.value) {
    let defaultWorkspaceId = cacheGet(workspaceCache, auth.tenantId)
    if (defaultWorkspaceId === undefined) {
      const { data: ws } = await supabaseAdmin
        .from("workspaces")
        .select("id")
        .eq("tenant_id", auth.tenantId)
        .eq("is_default", true)
        .maybeSingle()
      defaultWorkspaceId = ws?.id ?? null
      cacheSet(workspaceCache, auth.tenantId, defaultWorkspaceId, WORKSPACE_TTL_MS)
    }
    if (defaultWorkspaceId) {
      response.cookies.set("workspace_id", defaultWorkspaceId, cookieOptions)
    }
  }

  return response
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|gif|webp|avif|ico|css|js|mjs|woff2?|ttf|eot|txt|xml|webmanifest)(?:/.*)?$).*)",
  ],
}