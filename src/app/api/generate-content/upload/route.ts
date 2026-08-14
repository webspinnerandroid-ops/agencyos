import { NextRequest, NextResponse } from "next/server";
import { getTenantId, requireRole } from "@/lib/auth";
import { uploadStoredFile } from "@/lib/media/storage";

const MAX_UPLOAD_IMAGES = 3;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

/**
 * POST /api/generate-content/upload — multipart image upload for the
 * "upload my own images" option in Generate Content.
 *
 * Fields: `files` (one or more image files, max 3). Each file is persisted to
 * the tenant's Bunny storage zone and the public CDN URL is returned so the
 * generate-content route can embed them in the post instead of AI images.
 */
export async function POST(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    await requireRole("agency_editor");

    const form = await request.formData();
    const files = form
      .getAll("files")
      .filter((f): f is File => f instanceof File);

    if (files.length === 0) {
      return NextResponse.json(
        { error: "Select at least one image to upload" },
        { status: 400 }
      );
    }
    if (files.length > MAX_UPLOAD_IMAGES) {
      return NextResponse.json(
        { error: `Upload at most ${MAX_UPLOAD_IMAGES} images` },
        { status: 400 }
      );
    }

    const images: { url: string; name: string }[] = [];
    for (const file of files) {
      if (!file.type.startsWith("image/")) {
        return NextResponse.json(
          { error: `"${file.name}" is not an image file` },
          { status: 400 }
        );
      }
      if (file.size > MAX_FILE_BYTES) {
        return NextResponse.json(
          { error: `"${file.name}" is too large (max 10 MB)` },
          { status: 400 }
        );
      }

      const ext = (file.name.split(".").pop() ?? "png")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
      const safeExt = /^(png|jpe?g|gif|webp|avif)$/.test(ext) ? ext : "png";
      const bytes = Buffer.from(await file.arrayBuffer());
      const path = `uploads/${crypto.randomUUID()}.${safeExt}`;

      const url = await uploadStoredFile(
        tenantId,
        path,
        bytes,
        file.type || `image/${safeExt}`
      );
      if (!url) {
        return NextResponse.json(
          { error: "Upload failed — check storage configuration" },
          { status: 500 }
        );
      }
      images.push({ url, name: file.name.replace(/\.[^.]+$/, "") });
    }

    return NextResponse.json({ images });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
