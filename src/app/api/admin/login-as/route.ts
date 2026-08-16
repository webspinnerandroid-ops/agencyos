import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireRole } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * POST /api/admin/login-as  body { tenantId }
 *
 * Super admin only. Lets the platform super admin enter a tenant's panel to
 * help ("Login as...") — but ONLY when that tenant's agency admin has opted
 * in via Settings → Admin Assistance (tenants.allow_admin_access = true).
 * The super admin can never force this; and it is strictly one-way — the
 * tenant never receives super admin powers.
 *
 * It mints the same one-time magic link a password reset would (no password,
 * no 2FA challenge), returns the token, and the admin page completes it via
 * verifyOtp — the browser then holds the TENANT user's session.
 */
export async function POST(request: NextRequest) {
  try {
    await requireRole("super_admin");
    const body = (await request.json().catch(() => ({}))) as {
      tenantId?: string;
    };
    if (!body.tenantId) {
      return NextResponse.json({ error: "tenantId is required." }, { status: 400 });
    }

    const supabase = await createServiceClient();

    // 1. The tenant must have opted in — the super admin can never bypass it.
    const { data: tenant, error: tenantErr } = await supabase
      .from("tenants")
      .select("id, name, allow_admin_access")
      .eq("id", body.tenantId)
      .maybeSingle();
    if (tenantErr) {
      if (/column .*allow_admin_access.* does not exist|Could not find the 'allow_admin_access' column/i.test(tenantErr.message)) {
        return NextResponse.json(
          { error: "Admin assistance isn't enabled yet — apply migration 069 to add the allow_admin_access column." },
          { status: 500 }
        );
      }
      throw new Error(tenantErr.message);
    }
    if (!tenant) {
      return NextResponse.json({ error: "Tenant not found." }, { status: 404 });
    }
    if (tenant.allow_admin_access !== true) {
      return NextResponse.json(
        {
          error:
            "This tenant hasn't enabled admin assistance. The tenant's admin must turn it on in Settings → Admin Assistance first.",
        },
        { status: 403 }
      );
    }

    // 2. Find the tenant's highest-role user (agency_admin preferred) to sign in as.
    const { data: roleRows } = await supabase
      .from("user_roles")
      .select("user_id, role")
      .eq("tenant_id", tenant.id)
      .order("role", { ascending: false })
      .limit(50);
    if (!roleRows || roleRows.length === 0) {
      return NextResponse.json(
        { error: "This tenant has no users to sign in as." },
        { status: 404 }
      );
    }
    const ranked = [...roleRows].sort((a, b) => {
      const rank = (r: string) =>
        r === "super_admin" ? 4 : r === "agency_admin" ? 3 : r === "agency_editor" ? 2 : 1;
      return rank(b.role) - rank(a.role);
    });
    const targetUserId = ranked[0].user_id;
    if (ranked[0].role === "super_admin") {
      // Never "log in as" another super admin — the tool is for tenant panels.
      const next = ranked.find((r) => r.role !== "super_admin");
      if (!next) {
        return NextResponse.json(
          { error: "This tenant only has super-admin users — nothing to sign in as." },
          { status: 403 }
        );
      }
    }
    const finalUserId = ranked[0].role === "super_admin" ? (ranked.find((r) => r.role !== "super_admin") as { user_id: string }).user_id : targetUserId;

    // 3. Look up the email from auth.
    const authAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
    const { data: userData, error: userErr } = await authAdmin.auth.admin.getUserById(
      finalUserId
    );
    if (userErr || !userData?.user?.email) {
      return NextResponse.json(
        { error: "Could not look up that user's account." },
        { status: 500 }
      );
    }
    const email = userData.user.email;

    // 4. Mint a one-time magic link for them (same flow as a password reset).
    const { data: linkData, error: linkErr } = await authAdmin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    const actionLink = linkData?.properties?.action_link ?? "";
    const token = (() => {
      try {
        return new URL(actionLink).searchParams.get("token") ?? "";
      } catch {
        return "";
      }
    })();
    if (linkErr || !token) {
      return NextResponse.json(
        { error: "Could not generate a login link." },
        { status: 500 }
      );
    }

    return NextResponse.json({ token, email, tenantName: tenant.name });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
