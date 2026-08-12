import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * PATCH /api/media/videos/[id]
 * Body: { duration?: number }
 *
 * Stores the video's real duration (read client-side from the media element —
 * the server has no ffmpeg to probe MP4 metadata) into the asset metadata so
 * the library badge renders instantly on later visits instead of re-probing.
 */
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
    const body = await request.json().catch(() => ({}));
    const duration = Number(body?.duration);
    if (!Number.isFinite(duration) || duration <= 0) {
      return NextResponse.json({ error: "duration (seconds) is required" }, { status: 400 });
    }

    const supabase = await createServiceClient();
    const { data: asset } = await supabase
      .from("media_assets")
      .select("metadata")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!asset) {
      return NextResponse.json({ error: "Video not found" }, { status: 404 });
    }

    const metadata = {
      ...(asset.metadata ?? {}),
      durationSeconds: Math.round(duration * 10) / 10,
    };
    await supabase
      .from("media_assets")
      .update({ metadata })
      .eq("id", id)
      .eq("tenant_id", tenantId);

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Internal error" },
      { status: 500 }
    );
  }
}
