import { NextRequest, NextResponse } from "next/server";
import { getTenantId, requireRole } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * GET  /api/tenant/admin-access → { allowed: boolean }
 * POST /api/tenant/admin-access  body { allowed: boolean }
 *
 * The tenant's agency admins opt in to letting the platform super admin use
 * "Login as" to enter their panel for help. This is strictly one-way: the
 * tenant can never gain super admin access — it only opens the door for the
 * super admin to enter the tenant's own panel.
 */
export async function GET() {
  try {
    const tenantId = await getTenantId();
    const supabase = await createServiceClient();
    const { data, error } = await supabase
      .from("tenants")
      .select("allow_admin_access")
      .eq("id", tenantId)
      .maybeSingle();
    if (error) {
      if (/column .*allow_admin_access.* does not exist|Could not find the 'allow_admin_access' column/i.test(error.message)) {
        return NextResponse.json({ allowed: false });
      }
      throw new Error(error.message);
    }
    return NextResponse.json({
      allowed: data?.allow_admin_access === true,
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireRole("agency_admin");
    const tenantId = await getTenantId();
    const body = (await request.json().catch(() => ({}))) as {
      allowed?: boolean;
    };
    const allowed = body.allowed === true;

    const supabase = await createServiceClient();
    const { error } = await supabase
      .from("tenants")
      .update({ allow_admin_access: allowed })
      .eq("id", tenantId);
    if (error) {
      if (/column .*allow_admin_access.* does not exist|Could not find the 'allow_admin_access' column/i.test(error.message)) {
        return NextResponse.json(
          { error: "Admin assistance isn't enabled yet — apply migration 069 to add the allow_admin_access column." },
          { status: 500 }
        );
      }
      throw new Error(error.message);
    }
    return NextResponse.json({ allowed });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
