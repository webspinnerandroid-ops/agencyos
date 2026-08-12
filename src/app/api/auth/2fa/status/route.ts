import { NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";

/** GET /api/auth/2fa/status — { enrolled, enrolledAt } for the session user. */
export async function GET() {
  try {
    const userId = await getUserId();
    if (!userId) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const supabase = await createServiceClient();
    const { data } = await supabase
      .from("user_2fa")
      .select("enrolled_at")
      .eq("user_id", userId)
      .maybeSingle();
    return NextResponse.json({ enrolled: !!data, enrolledAt: data?.enrolled_at ?? null });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Internal error" }, { status: 500 });
  }
}
