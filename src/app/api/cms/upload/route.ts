import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { uploadStoredFile } from "@/lib/media/storage";

/**
 * POST /api/cms/upload — multipart image upload for the page builder.
 * Fields: file (image). Returns { url, alt } for the image block.
 * Stored at cms/<random>.<ext> in the tenant's Bunny zone.
 */
export async function POST(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    if (!tenantId) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: "File too large (max 10 MB)" }, { status: 400 });
    }

    const ext = (file.name.split(".").pop() ?? "png").toLowerCase().replace(/[^a-z0-9]/g, "");
    const safeExt = /^(png|jpe?g|gif|webp|avif|svg|heic)$/.test(ext) ? ext : "png";
    const bytes = Buffer.from(await file.arrayBuffer());
    const name = `cms/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${safeExt}`;

    const url = await uploadStoredFile(tenantId, name, bytes, file.type || `image/${safeExt}`);
    if (!url) {
      return NextResponse.json({ error: "Upload failed — check Bunny storage config" }, { status: 500 });
    }
    return NextResponse.json({ url, alt: file.name.replace(/\.[^.]+$/, "") });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Internal error" }, { status: 500 });
  }
}
