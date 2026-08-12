import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { verifyTotp } from "@/lib/totp";
import { decrypt } from "@/lib/encryption";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * POST /api/auth/2fa/disable — body { code }
 * Requires a valid current authenticator code before removing 2FA.
 */
export async function POST(request: NextRequest) {
  try {
    const userId = await getUserId();
    if (!userId) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const body = await request.json().catch(() => ({}));
    const code = String(body.code ?? "").trim();
    if (!/^\d{6}$/.test(code)) {
      return NextResponse.json({ error: "Enter the 6-digit code from your authenticator app." }, { status: 400 });
    }

    const supabase = await createServiceClient();
    const { data: record } = await supabase
      .from("user_2fa")
      .select("secret_encrypted")
      .eq("user_id", userId)
      .maybeSingle();
    if (!record) {
      return NextResponse.json({ error: "Two-factor authentication is not enabled." }, { status: 400 });
    }
    if (!verifyTotp(decrypt(record.secret_encrypted), code)) {
      return NextResponse.json({ error: "Invalid code — 2FA was not disabled." }, { status: 400 });
    }

    const { error } = await supabase.from("user_2fa").delete().eq("user_id", userId);
    if (error) throw error;
    return NextResponse.json({ ok: true, disabled: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Internal error" }, { status: 500 });
  }
}
