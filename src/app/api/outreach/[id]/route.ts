import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";

/** PATCH /api/outreach/[id] — update status, pitch, or notes. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const tenantId = await getTenantId();
    if (!tenantId) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as Record<string, any>;

    const patch: Record<string, unknown> = {};
    if (typeof body.status === "string") patch.status = body.status;
    if (typeof body.notes === "string") patch.notes = body.notes.slice(0, 2000);
    if (typeof body.pitch === "string") patch.pitch = body.pitch.slice(0, 10_000);
    if (typeof body.contact_email === "string") patch.contact_email = body.contact_email.slice(0, 300);
    if (patch.status === "pitched" || patch.status === "accepted" || patch.status === "published") {
      patch.pitch_sent_at = patch.pitch_sent_at ?? new Date().toISOString();
    }

    const supabase = await createServiceClient();
    const { data, error } = await supabase
      .from("outreach_targets")
      .update(patch)
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .select("*")
      .single();
    if (error) throw error;
    return NextResponse.json({ target: data });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Internal error" }, { status: 500 });
  }
}

/** DELETE /api/outreach/[id] */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const tenantId = await getTenantId();
    if (!tenantId) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const { id } = await params;
    const supabase = await createServiceClient();
    const { error } = await supabase
      .from("outreach_targets")
      .delete()
      .eq("id", id)
      .eq("tenant_id", tenantId);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Internal error" }, { status: 500 });
  }
}
