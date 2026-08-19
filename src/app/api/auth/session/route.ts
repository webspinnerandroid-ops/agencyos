import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

/** Current Supabase project ref from env, e.g. "axqcmiisztnqcntprhdy". */
function currentSupabaseRef(): string | undefined {
  return process.env.NEXT_PUBLIC_SUPABASE_URL?.match(
    /https:\/\/([a-z0-9]+)\.supabase\.co/
  )?.[1];
}

/**
 * Find the Supabase auth-token cookie (supports any project ref + chunked
 * cookies). Prefers the cookie for the CURRENT project ref so a stale session
 * from a different Supabase project can't shadow the real one — the cause of
 * "signed in but bounced back to /login". Mirrors the auth proxy's logic so
 * this endpoint reports the exact same session state the proxy sees on the
 * next navigation.
 */
function findSupabaseAccessToken(request: NextRequest): string | undefined {
  const byName = new Map<string, string[]>();
  const chunked = new Map<string, Map<number, string>>();

  for (const cookie of request.cookies.getAll()) {
    const chunkMatch = cookie.name.match(/^(sb-.+-auth-token)\.(\d+)$/);
    if (chunkMatch) {
      const base = chunkMatch[1];
      const idx = parseInt(chunkMatch[2], 10);
      if (!chunked.has(base)) chunked.set(base, new Map());
      chunked.get(base)!.set(idx, cookie.value);
      continue;
    }
    const base = cookie.name.replace(/\.\d+$/, "");
    if (base.match(/^sb-.+-auth-token$/)) {
      if (!byName.has(base)) byName.set(base, []);
      byName.get(base)![0] = cookie.value;
    }
  }

  for (const [base, parts] of chunked) {
    const assembled = [...parts.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, v]) => v)
      .join("");
    if (assembled) {
      if (!byName.has(base)) byName.set(base, []);
      byName.get(base)![0] = assembled;
    }
  }

  const ref = currentSupabaseRef();
  if (ref) {
    const preferred = byName.get(`sb-${ref}-auth-token`);
    if (preferred?.[0]) return preferred[0];
  }
  for (const [, parts] of byName) {
    if (parts[0]) return parts[0];
  }
  return undefined;
}

/** Parse access + refresh tokens out of the raw Supabase auth cookie value. */
function parseAuthCookieValue(cookieValue: string): {
  accessToken: string;
  refreshToken: string | null;
} {
  try {
    const raw = cookieValue.startsWith("base64-")
      ? Buffer.from(cookieValue.slice("base64-".length), "base64").toString("utf-8")
      : decodeURIComponent(cookieValue);
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return { accessToken: parsed[0], refreshToken: parsed[1] ?? null };
    }
    return {
      accessToken: parsed.access_token ?? cookieValue,
      refreshToken: parsed.refresh_token ?? null,
    };
  } catch {
    return { accessToken: cookieValue, refreshToken: null };
  }
}

/**
 * GET /api/auth/session
 *
 * Verifies the session from the request's Supabase auth cookie using the
 * exact same decoding as the auth proxy. The login page polls this after a
 * successful sign-in and only navigates once it returns ok — eliminating
 * the "signed in but bounced back to /login" race where the browser
 * navigated before the session cookie was visible to the proxy.
 */
export async function GET(request: NextRequest) {
  try {
    const raw = findSupabaseAccessToken(request);
    if (!raw) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }
    const { accessToken } = parseAuthCookieValue(raw);
    const {
      data: { user },
    } = await supabaseAdmin.auth.getUser(accessToken);
    if (!user) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }

    // Sweep stale auth cookies from other Supabase projects off the browser
    // so they stop shadowing the current session.
    // Also resolve the caller's role (best-effort) so client components can
    // gate super-admin-only options (e.g. the Site Blog publish target).
    let role: string | null = null;
    try {
      const { data: userRole } = await supabaseAdmin
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .maybeSingle();
      role = userRole?.role ?? null;
    } catch {
      role = null;
    }
    const response = NextResponse.json({ ok: true, email: user.email, role });
    const ref = currentSupabaseRef();
    if (ref) {
      const expected = `sb-${ref}-auth-token`;
      for (const cookie of request.cookies.getAll()) {
        const base = cookie.name.replace(/\.\d+$/, "");
        if (base !== expected && base.match(/^sb-.+-auth-token$/)) {
          response.cookies.delete(cookie.name);
        }
      }
    }
    return response;
  } catch {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
}
