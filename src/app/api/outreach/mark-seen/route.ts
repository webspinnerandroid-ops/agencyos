import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * POST /api/outreach/mark-seen
 * Body: { ids?: string[] } — optional; when omitted, marks ALL unseen replies
 * for the tenant as seen (e.g. when the user visits the outreach page).
 */
export async function POST(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    if (!tenantId) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const body = await request.json().catch(() => ({}));
    const ids = Array.isArray(body.ids) ? body.ids.map(String) : null;

    const supabase = await createServiceClient();
    let q = supabase
      .from("outreach_targets")
      .update({ last_reply_seen: true })
      .eq("tenant_id", tenantId)
      .eq("last_reply_seen", false)
      .not("last_reply_at", "is", null);

    if (ids && ids.length > 0) q = q.in("id", ids);
    const { error } = await q;
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Internal error" }, { status: 500 });
  }
}
