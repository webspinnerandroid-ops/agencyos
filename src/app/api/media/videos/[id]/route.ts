import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * PATCH /api/media/videos/[id]
 * Body: { duration?: number; resolution?: string; codec?: string }
 *
 * Stores video facts read client-side from the media element (the server has
 * no ffmpeg to probe MP4 metadata): real duration, resolution (e.g.
 * "1280x720") and codec. All are optional — whatever the client could read
 * gets merged into the asset metadata so library badges render instantly on
 * later visits instead of re-probing the CDN.
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
    const resolution = typeof body?.resolution === "string" ? body.resolution.trim() : "";
    const codec = typeof body?.codec === "string" ? body.codec.trim() : "";
    if ((!Number.isFinite(duration) || duration <= 0) && !resolution && !codec) {
      return NextResponse.json(
        { error: "provide duration, resolution, or codec" },
        { status: 400 }
      );
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

    const metadata = { ...(asset.metadata ?? {}) } as Record<string, unknown>;
    if (Number.isFinite(duration) && duration > 0) {
      metadata.durationSeconds = Math.round(duration * 10) / 10;
    }
    if (resolution) metadata.resolution = resolution;
    if (codec) metadata.codec = codec;
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
