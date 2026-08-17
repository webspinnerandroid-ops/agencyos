import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { getTenantThemeSafe, encodeTenantTheme } from "@/lib/tenant"

const PUBLIC_ROUTES = ["/login", "/register", "/forgot-password", "/reset-password", "/pending-approval", "/help", "/about", "/contact", "/privacy", "/data-deletion", "/terms", "/seo/proposal", "/audit", "/site", "/sign", "/api/webhooks", "/api/auth/callback", "/api/auth/session", "/api/auth/dev-login", "/api/register", "/api/data-deletion", "/api/inngest", "/api/docusign/connect", "/api/seo/public-proposal", "/api/seo/public-audit", "/api/cms/forms", "/api/outreach/reply-webhook", "/api/sign", "/_next", "/favicon.ico", "/robots.txt", "/sitemap.xml", "/og-image.png", "/"]

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
  // API fetches expect JSON — a redirect to the (HTML) login page makes the
  // client's res.json() throw `Unexpected token '<'...`. Return a parseable
  // 401 so the UI can show a clean session-expired message instead.
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Session expired — please log in again.", code: "session_expired" },
      { status: 401 }
    )
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

const SITE_DOMAIN_TTL_MS = 5 * 60_000
/** null value = host is not a mapped custom domain */
const siteDomainCache = new Map<string, { value: string | null; expiresAt: number }>()

const WORKSPACE_TTL_MS = 5 * 60_000
/** null value = tenant has no default workspace yet */
const workspaceCache = new Map<string, { value: string | null; expiresAt: number }>()
/** cached set of workspace ids per tenant, used to validate incoming workspace_id cookies */
const workspaceIdsCache = new Map<string, { value: string[]; expiresAt: number }>()

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

/** Current Supabase project ref from env, e.g. "axqcmiisztnqcntprhdy". */
function currentSupabaseRef(): string | undefined {
  return process.env.NEXT_PUBLIC_SUPABASE_URL?.match(
    /https:\/\/([a-z0-9]+)\.supabase\.co/
  )?.[1]
}

/**
 * Find the Supabase auth-token cookie (supports chunked cookies). Prefers the
 * cookie for the CURRENT project ref — a stale session cookie from a different
 * Supabase project (old env, previous project) must not shadow the real one,
 * or a fresh sign-in gets bounced straight back to /login.
 */
function findSupabaseAccessToken(request: NextRequest): string | undefined {
  const byName = new Map<string, string[]>()
  const chunked = new Map<string, Map<number, string>>()

  for (const cookie of request.cookies.getAll()) {
    // Cookie chunking: sb-{project-ref}-auth-token.{0,1,2,...}
    const chunkMatch = cookie.name.match(/^(sb-.+-auth-token)\.(\d+)$/)
    if (chunkMatch) {
      const base = chunkMatch[1]
      const idx = parseInt(chunkMatch[2], 10)
      if (!chunked.has(base)) chunked.set(base, new Map())
      chunked.get(base)!.set(idx, cookie.value)
      continue
    }
    const base = cookie.name.replace(/\.\d+$/, "")
    if (base.match(/^sb-.+-auth-token$/)) {
      if (!byName.has(base)) byName.set(base, [])
      byName.get(base)![0] = cookie.value
    }
  }

  // Reassemble chunked cookies under their base name.
  for (const [base, parts] of chunked) {
    const assembled = [...parts.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, v]) => v)
      .join("")
    if (assembled) {
      if (!byName.has(base)) byName.set(base, [])
      byName.get(base)![0] = assembled
    }
  }

  // Prefer the current project's cookie so a stale foreign session can't
  // shadow the real one (the cause of "signed in but bounced back to /login").
  const ref = currentSupabaseRef()
  if (ref) {
    const preferred = byName.get(`sb-${ref}-auth-token`)
    if (preferred?.[0]) return preferred[0]
  }
  for (const [, parts] of byName) {
    if (parts[0]) return parts[0]
  }
  return undefined
}

/** Parse access + refresh tokens out of the raw Supabase auth cookie value. */
function parseAuthCookieValue(cookieValue: string): {
  accessToken: string
  refreshToken: string | null
} {
  try {
    const raw = cookieValue.startsWith("base64-")
      ? Buffer.from(cookieValue.slice("base64-".length), "base64").toString("utf-8")
      : decodeURIComponent(cookieValue)
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return { accessToken: parsed[0], refreshToken: parsed[1] ?? null }
    }
    return {
      accessToken: parsed.access_token ?? cookieValue,
      refreshToken: parsed.refresh_token ?? null,
    }
  } catch {
    return { accessToken: cookieValue, refreshToken: null }
  }
}

/** Base cookie name for the Supabase auth token, e.g. sb-<ref>-auth-token. */
function findAuthCookieName(request: NextRequest): string | undefined {
  const ref = currentSupabaseRef()
  if (ref) {
    const name = `sb-${ref}-auth-token`
    for (const cookie of request.cookies.getAll()) {
      if (cookie.name.replace(/\.\d+$/, "") === name) return name
    }
  }
  for (const cookie of request.cookies.getAll()) {
    const base = cookie.name.replace(/\.\d+$/, "")
    if (base.match(/^sb-.+-auth-token$/)) return base
  }
  return undefined
}

/**
 * Sweep stale auth cookies from other Supabase projects off the browser so
 * they stop shadowing the current session (and stop growing unbounded).
 */
function clearForeignAuthCookies(request: NextRequest, response: NextResponse) {
  const ref = currentSupabaseRef()
  if (!ref) return
  const expected = `sb-${ref}-auth-token`
  for (const cookie of request.cookies.getAll()) {
    const base = cookie.name.replace(/\.\d+$/, "")
    if (base !== expected && base.match(/^sb-.+-auth-token$/)) {
      response.cookies.delete(cookie.name)
    }
  }
}

const AUTH_COOKIE_CHUNK_SIZE = 3180

/**
 * Write a refreshed Supabase session back to the auth-token cookie using the
 * same `base64-` + base64url(JSON) encoding and chunking scheme @supabase/ssr
 * uses, so every reader (browser client, server client, this proxy) parses it
 * identically. Stale chunks from a previous larger session are cleared so the
 * reassembler never mixes cookie generations.
 */
function setSupabaseAuthCookie(
  request: NextRequest,
  response: NextResponse,
  session: { access_token: string; refresh_token: string; expires_at?: number }
) {
  const cookieName = findAuthCookieName(request)
  if (!cookieName) return
  const value =
    "base64-" + Buffer.from(JSON.stringify(session), "utf-8").toString("base64url")
  const encoded = encodeURIComponent(value)
  const options = {
    path: "/",
    sameSite: "lax" as const,
    httpOnly: false,
    secure: request.nextUrl.protocol === "https:",
    maxAge: 60 * 60 * 24 * 30,
  }
  // Clear prior chunks so a shrink (e.g. 3 chunks → 1) can't leave stale parts.
  for (let i = 0; i < 12; i++) {
    response.cookies.delete({ name: `${cookieName}.${i}`, path: "/" })
  }
  if (encoded.length <= AUTH_COOKIE_CHUNK_SIZE) {
    response.cookies.set(cookieName, value, options)
    return
  }
  // Chunk like @supabase/ssr: split the URL-encoded value at safe boundaries.
  let remaining = encoded
  let i = 0
  while (remaining.length > 0) {
    let head = remaining.slice(0, AUTH_COOKIE_CHUNK_SIZE)
    const lastEscape = head.lastIndexOf("%")
    if (lastEscape > AUTH_COOKIE_CHUNK_SIZE - 3) head = head.slice(0, lastEscape)
    let chunk = ""
    while (head.length > 0) {
      try {
        chunk = decodeURIComponent(head)
        break
      } catch {
        head = head.slice(0, Math.max(0, head.length - 3))
      }
    }
    if (chunk) response.cookies.set(`${cookieName}.${i}`, chunk, options)
    remaining = remaining.slice(head.length)
    i++
  }
}

export default async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Custom domains mapped to CMS sites (site_domains): rewrite the request to
  // /site/<slug> so client.com serves the tenant's page. Must run before the
  // public-route check because a custom domain's request comes in at /.
  const host = (request.headers.get("host") ?? "").toLowerCase()
  const platformHost = (process.env.NEXT_PUBLIC_SITE_URL ?? "")
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "")
    .toLowerCase()
  if (host && platformHost && host !== platformHost) {
    let slug = cacheGet(siteDomainCache, host)
    if (slug === undefined) {
      const adminClient = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } }
      )
      const { data: mapped } = await adminClient
        .from("site_domains")
        .select("site_slug")
        .eq("domain", host)
        .maybeSingle()
      slug = mapped?.site_slug ?? null
      cacheSet(siteDomainCache, host, slug, SITE_DOMAIN_TTL_MS)
    }
    if (slug) {
      const url = request.nextUrl.clone()
      url.pathname = `/site/${slug}${pathname === "/" ? "" : pathname}`
      url.search = request.nextUrl.search
      return NextResponse.rewrite(url)
    }
  }

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

  // Extract the access + refresh tokens from the cookie. Supabase may store
  // the value as a raw JSON array or a base64- prefixed session object.
  const { accessToken: token, refreshToken } = parseAuthCookieValue(accessToken)

  // Cached auth context? Keyed by the raw cookie so a refreshed session (new
  // token) re-verifies instead of reusing a stale entry.
  let auth = cacheGet(authCache, accessToken)

  // Set when this request refreshes an expired access token — the new session
  // is written back to the auth cookie on the response.
  let refreshedSession: {
    access_token: string
    refresh_token: string
    expires_at?: number
  } | null = null

  // refreshSession() mutates the client's internal auth state, so any DB
  // query on that client would then send the USER's JWT (RLS hides rows)
  // instead of the service key. After a refresh, point this at a fresh
  // admin client for all subsequent queries.
  let dbClient = supabaseAdmin

  if (auth === undefined) {
    let userId: string | null = null
    let userEmail = ""

    const {
      data: { user },
      error: userError,
    } = await supabaseAdmin.auth.getUser(token)

    if (userError || !user) {
      // Access token expired or invalid — try to refresh the session with the
      // refresh token from the auth cookie before redirecting to login. This
      // keeps users logged in across the 1-hour access-token TTL (the refresh
      // token lives up to 30 days and rotates on every use) instead of
      // booting them to the login page every hour.
      if (refreshToken) {
        const { data: refreshed, error: refreshError } =
          await supabaseAdmin.auth.refreshSession({ refresh_token: refreshToken })
        if (!refreshError && refreshed.session?.user) {
          refreshedSession = refreshed.session
          userId = refreshed.session.user.id
          userEmail = refreshed.session.user.email ?? ""
        }
      }
      if (!refreshedSession) {
        return authFailureResponse(request)
      }
    } else {
      userId = user.id
      userEmail = user.email ?? ""
    }
    if (!userId) {
      return authFailureResponse(request)
    }

    if (refreshedSession) {
      dbClient = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } }
      )
    }

    const { data: userRole } = await dbClient
      .from("user_roles")
      .select("tenant_id, role, client_id")
      .eq("user_id", userId)
      .single()

    if (!userRole) {
      cacheSet(authCache, accessToken, null, AUTH_TTL_MS)
      const pendingUrl = request.nextUrl.clone()
      pendingUrl.pathname = "/pending-approval"
      return NextResponse.redirect(pendingUrl)
    }

    auth = {
      userId,
      email: userEmail,
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

  // Workspace cookie handling. Setting the `workspace_id` cookie here means
  // getCurrentWorkspaceId() in pages/actions hits the cookie path instead of
  // doing a DB query per page render (the fallback that caused slow
  // first-loads).
  //
  // Ownership check: a stale workspace_id cookie can survive a tenant switch
  // (e.g. the same origin was used by another tenant's session), and trusting
  // it would scope THIS tenant's writes to ANOTHER tenant's workspace — a
  // cross-tenant data leak. So an incoming cookie is only kept if it belongs
  // to the authenticated tenant; otherwise it is overwritten with this
  // tenant's default workspace. A user's legitimately selected workspace
  // (from WorkspaceSelector) is untouched because it is in the tenant's set.
  // The same caveat applies to the workspace queries below, so reuse the
  // (possibly fresh) dbClient for them.
  let defaultWorkspaceId = cacheGet(workspaceCache, auth.tenantId)
  if (defaultWorkspaceId === undefined) {
    const { data: ws } = await dbClient
      .from("workspaces")
      .select("id")
      .eq("tenant_id", auth.tenantId)
      .eq("is_default", true)
      .maybeSingle()
    defaultWorkspaceId = ws?.id ?? null
    cacheSet(workspaceCache, auth.tenantId, defaultWorkspaceId, WORKSPACE_TTL_MS)
  }

  const incomingWorkspaceId = request.cookies.get("workspace_id")?.value
  if (incomingWorkspaceId) {
    let workspaceIds = cacheGet(workspaceIdsCache, auth.tenantId)
    if (workspaceIds === undefined) {
      const { data: wsRows } = await dbClient
        .from("workspaces")
        .select("id")
        .eq("tenant_id", auth.tenantId)
      workspaceIds = (wsRows ?? []).map((w) => w.id)
      cacheSet(workspaceIdsCache, auth.tenantId, workspaceIds, WORKSPACE_TTL_MS)
    }
    if (!workspaceIds.includes(incomingWorkspaceId)) {
      if (defaultWorkspaceId) {
        response.cookies.set("workspace_id", defaultWorkspaceId, cookieOptions)
      } else {
        response.cookies.delete("workspace_id")
      }
    }
  } else if (defaultWorkspaceId) {
    response.cookies.set("workspace_id", defaultWorkspaceId, cookieOptions)
  }

  // If we refreshed the session, hand the browser the new auth cookie so the
  // next request carries the fresh access token (the old one is now invalid).
  if (refreshedSession) {
    setSupabaseAuthCookie(request, response, refreshedSession)
  }

  // Drop stale auth cookies from other Supabase projects — they shadow the
  // real session and were the root cause of sign-in bounce loops.
  clearForeignAuthCookies(request, response)

  return response
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|gif|webp|avif|ico|css|js|mjs|woff2?|ttf|eot|txt|xml|webmanifest)(?:/.*)?$).*)",
  ],
}