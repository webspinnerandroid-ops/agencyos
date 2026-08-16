import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * POST /api/auth/dev-login
 *
 * DEV-ONLY convenience: signs the workspace owner (super admin) in via a
 * passwordless magic link WITHOUT sending email. Supabase's admin API can
 * generate the same one-time link the email would contain, and `verifyOtp`
 * with the token completes the login — no password, no 2FA challenge, and
 * the owner email never leaves this server.
 *
 * Hard-gated so it can NEVER run in production or in a normal local build:
 * the route 404s unless BOTH of these are set (only in a local .env.local):
 *   - ALLOW_DEV_LOGIN=true          (server guard)
 *   - DEV_ADMIN_EMAIL=<owner email> (whose magic link to mint)
 */
export async function POST(request: NextRequest) {
  if (process.env.ALLOW_DEV_LOGIN !== "true") {
    return NextResponse.json({ error: "Dev login is not enabled." }, { status: 404 });
  }

  const ownerEmail = (process.env.DEV_ADMIN_EMAIL ?? "").trim().toLowerCase();
  if (!ownerEmail) {
    return NextResponse.json(
      { error: "DEV_ADMIN_EMAIL is not set in the local environment." },
      { status: 500 }
    );
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  // Confirm the account exists and is a super admin before minting anything.
  const {
    data: { users },
    error: listErr,
  } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listErr) {
    console.error("[dev-login] listUsers failed:", listErr.message);
    return NextResponse.json({ error: "Could not look up the owner account." }, { status: 500 });
  }
  const owner = (users ?? []).find(
    (u) => u.email?.trim().toLowerCase() === ownerEmail && u.email_confirmed_at != null
  );
  if (!owner?.email) {
    return NextResponse.json({ error: "No confirmed owner account with that email." }, { status: 404 });
  }

  const { data: roles } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", owner.id)
    .limit(20);
  const isSuperAdmin = (roles ?? []).some((r) => r.role === "super_admin");
  if (!isSuperAdmin) {
    return NextResponse.json(
      { error: "That account is not a super admin." },
      { status: 403 }
    );
  }

  const { data, error } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email: owner.email,
  });
  const actionLink = data?.properties?.action_link ?? "";
  const token = (() => {
    try {
      return new URL(actionLink).searchParams.get("token") ?? "";
    } catch {
      return "";
    }
  })();

  if (error || !token) {
    console.error("[dev-login] generateLink failed:", error?.message ?? "no token in link");
    return NextResponse.json({ error: "Could not generate a login link." }, { status: 500 });
  }

  return NextResponse.json({ token, email: owner.email });
}
