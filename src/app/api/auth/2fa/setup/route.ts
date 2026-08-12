import { NextResponse } from "next/server";
import { getUserId, getUserEmail } from "@/lib/auth";
import { generateSecret, provisioningUri } from "@/lib/totp";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * POST /api/auth/2fa/setup
 *
 * Generates a new TOTP secret + otpauth URI for QR enrollment. Only allowed
 * when the user has NOT already enrolled (disable first to re-enroll).
 */
export async function POST() {
  try {
    const userId = await getUserId();
    if (!userId) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const email = (await getUserEmail().catch(() => null)) ?? "user@agencyos.app";

    const supabase = await createServiceClient();
    const { data: existing } = await supabase
      .from("user_2fa")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (existing) {
      return NextResponse.json(
        { error: "Two-factor authentication is already enabled. Disable it first to re-enroll." },
        { status: 409 }
      );
    }

    const secret = generateSecret();
    return NextResponse.json({ secret, otpauthUri: provisioningUri(email, secret) });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Internal error" }, { status: 500 });
  }
}
