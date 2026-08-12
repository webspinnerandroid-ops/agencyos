import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { persistImageToStorage } from "@/lib/media/storage";

/**
 * POST /api/media/videos/[id]/thumbnail
 * Body: { image: "data:image/jpeg;base64,..." }
 *
 * Stores a captured poster frame for a completed video. The browser captures
 * the frame client-side (no ffmpeg on the server) and uploads the data URL
 * here; it's persisted to Bunny and saved on the asset's thumbnail_url.
 */
export async function POST(
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
    const image = typeof body?.image === "string" ? body.image : "";
    if (!image.startsWith("data:image/")) {
      return NextResponse.json({ error: "image (data URL) is required" }, { status: 400 });
    }

    const supabase = await createServiceClient();
    const { data: asset } = await supabase
      .from("media_assets")
      .select("id")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!asset) {
      return NextResponse.json({ error: "Video not found" }, { status: 404 });
    }

    const url = await persistImageToStorage(tenantId, image);
    await supabase
      .from("media_assets")
      .update({ thumbnail_url: url })
      .eq("id", id)
      .eq("tenant_id", tenantId);

    return NextResponse.json({ thumbnail_url: url });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Internal error" },
      { status: 500 }
    );
  }
}
