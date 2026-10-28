import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { verifyTotp } from "@/lib/totp";
import { encrypt, decrypt } from "@/lib/encryption";
import { createServiceClient } from "@/lib/supabase/server";
import { parseJsonBody } from "@/lib/api-validate";
import { authTotpVerifySchema } from "@/lib/validations";

/**
 * POST /api/auth/2fa/verify
 *
 * Two modes:
 *  - Setup: body { code, secret } — validates the code against the pending
 *    secret from /setup, then stores it encrypted (enrolls the user).
 *  - Login: body { code } — validates the code against the user's stored
 *    secret (called after a successful password sign-in; the session must
 *    belong to the enrolling user). Marks last_verified_at on success.
 */
export async function POST(request: NextRequest) {
  try {
    const userId = await getUserId();
    if (!userId) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const parsed = await parseJsonBody(request, authTotpVerifySchema);
    if (!parsed.ok) return parsed.response;
    const { code, secret } = parsed.data;
    const pendingSecret = secret ?? "";

    const supabase = await createServiceClient();

    if (pendingSecret) {
      // Setup mode: verify against the pending secret, then enroll.
      if (!verifyTotp(pendingSecret, code)) {
        return NextResponse.json({ error: "That code didn't match — check the time on your device and try again." }, { status: 400 });
      }
      const { data: existing } = await supabase
        .from("user_2fa")
        .select("user_id")
        .eq("user_id", userId)
        .maybeSingle();
      if (existing) {
        return NextResponse.json({ error: "Two-factor authentication is already enabled." }, { status: 409 });
      }
      const { error } = await supabase.from("user_2fa").insert({
        user_id: userId,
        secret_encrypted: encrypt(pendingSecret),
        last_verified_at: new Date().toISOString(),
      });
      if (error) throw error;
      return NextResponse.json({ ok: true, enrolled: true });
    }

    // Login mode: verify against the stored secret.
    const { data: record } = await supabase
      .from("user_2fa")
      .select("secret_encrypted")
      .eq("user_id", userId)
      .maybeSingle();
    if (!record) {
      return NextResponse.json({ error: "Two-factor authentication is not enabled for this account." }, { status: 400 });
    }
    const storedSecret = decrypt(record.secret_encrypted);
    if (!verifyTotp(storedSecret, code)) {
      return NextResponse.json({ error: "Invalid code — try again." }, { status: 400 });
    }
    await supabase
      .from("user_2fa")
      .update({ last_verified_at: new Date().toISOString() })
      .eq("user_id", userId);
    return NextResponse.json({ ok: true, verified: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Internal error" }, { status: 500 });
  }
}
