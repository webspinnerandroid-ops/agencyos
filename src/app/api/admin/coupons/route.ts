import { NextRequest, NextResponse } from "next/server";
import { getTenantId, getUserId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Super-admin coupon management.
 *
 * GET  — all coupon codes with usage counts.
 * POST — issue a new code { code, percentOff, planId?, expiresAt?, maxUses? }.
 *
 * Codes are platform-wide (not tenant-scoped): only the super admin can
 * create them, and any tenant can apply them at checkout.
 */
async function requireAdmin(): Promise<{ supabase: any } | { error: string }> {
  const tenantId = await getTenantId();
  const userId = await getUserId();
  if (!tenantId || !userId) return { error: "Authentication required" };
  const supabase = await createServiceClient();
  const { data: roles } = await supabase
    .from("user_roles")
    .select("role")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId);
  const isAdmin = (roles ?? []).some((r: any) => r.role === "super_admin");
  return isAdmin ? { supabase } : { error: "Super admin access required" };
}

export async function GET() {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: 403 });
    const { data, error } = await auth.supabase
      .from("coupon_codes")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    return NextResponse.json({ coupons: data ?? [] });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Internal error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: 403 });
    const userId = await getUserId();
    const body = await request.json().catch(() => ({}));

    const code = String(body.code ?? "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "-");
    const percentOff = Math.round(Number(body.percentOff));
    if (!code || code.length < 3) {
      return NextResponse.json({ error: "code is required (min 3 chars)" }, { status: 400 });
    }
    if (!Number.isFinite(percentOff) || percentOff < 1 || percentOff > 100) {
      return NextResponse.json({ error: "percentOff must be between 1 and 100" }, { status: 400 });
    }
    const maxUses = Number(body.maxUses);
    const patch: Record<string, unknown> = {
      code,
      percent_off: percentOff,
      plan_id: String(body.planId ?? "").trim() || null,
      expires_at: body.expiresAt ? new Date(String(body.expiresAt)).toISOString() : null,
      max_uses: Number.isFinite(maxUses) && maxUses > 0 ? Math.floor(maxUses) : null,
      active: true,
      created_by: userId,
    };

    const { data, error } = await auth.supabase
      .from("coupon_codes")
      .insert(patch)
      .select("*")
      .single();
    if (error) {
      const dup = String(error.message).toLowerCase().includes("duplicate");
      return NextResponse.json(
        { error: dup ? `Code "${code}" already exists` : error.message },
        { status: dup ? 409 : 500 }
      );
    }
    return NextResponse.json({ coupon: data });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Internal error" }, { status: 500 });
  }
}
