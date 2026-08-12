import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/auth/session
 *
 * Verifies the session from the request's Supabase auth cookie (the same
 * cookie the proxy uses). The login page polls this after a successful
 * sign-in and only navigates once the cookie is actually visible to the
 * server — eliminating the "signed in but bounced back to /login" race
 * where the browser navigated before the session cookie was written.
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }
    return NextResponse.json({ ok: true, email: user.email });
  } catch {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
}
