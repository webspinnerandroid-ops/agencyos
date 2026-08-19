import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { getCurrentWorkspaceId } from "@/lib/workspace";
import {
  type ConnectionRecord,
  encodeTokenBundle,
  getAccessToken,
} from "@/lib/connections";

/** Pick a sane filename + mime from the asset type and its URL extension. */
function filenameAndMime(
  type: string,
  url: string,
  prompt: string
): { name: string; mime: string } {
  const extMatch = (url.split("?")[0].match(/\.([a-z0-9]{2,5})$/i) ?? [])[1]?.toLowerCase();
  let ext = extMatch;
  let mime = "application/octet-stream";
  if (type === "video") {
    ext = ext ?? "mp4";
    mime = ext === "webm" ? "video/webm" : ext === "mov" ? "video/quicktime" : "video/mp4";
  } else if (type === "voice") {
    ext = ext ?? "mp3";
    mime = ext === "wav" ? "audio/wav" : ext === "ogg" ? "audio/ogg" : "audio/mpeg";
  } else {
    ext = ext ?? "png";
    mime =
      ext === "svg" ? "image/svg+xml"
      : ext === "jpg" || ext === "jpeg" ? "image/jpeg"
      : ext === "webp" ? "image/webp"
      : ext === "gif" ? "image/gif"
      : "image/png";
  }

  const slug = (prompt || "asset")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "asset";

  return { name: `${slug}.${ext}`, mime };
}

/**
 * POST /api/media-assets/[id]/drive
 * Uploads the asset's bytes into the workspace's attached Google Drive folder
 * (tenant_connections where provider = 'google_drive' and selected_resource
 * is the folder id). Returns the created Drive file id + name.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const tenantId = await getTenantId();
    const workspaceId = await getCurrentWorkspaceId().catch(() => null);
    const supabase = await createServiceClient();
    const { id } = await params;

    const { data: asset, error: assetErr } = await supabase
      .from("media_assets")
      .select("id, type, prompt, url, workspace_id")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (assetErr || !asset) {
      return NextResponse.json(
        { error: "Asset not found or access denied" },
        { status: 404 }
      );
    }
    if (!asset.url) {
      return NextResponse.json(
        { error: "This asset has no file URL to save." },
        { status: 400 }
      );
    }

    // Resolve the workspace's Drive connection (workspace row wins, then the
    // legacy tenant-wide NULL row — same rule as the connections page).
    const { data: connRows, error: connErr } = await supabase
      .from("tenant_connections")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("provider", "google_drive");

    if (connErr) throw new Error(connErr.message);
    const rows = (connRows ?? []) as ConnectionRecord[];
    const conn = workspaceId
      ? rows.find((r) => r.workspace_id === workspaceId) ??
        rows.find((r) => !r.workspace_id) ??
        rows[0]
      : rows[0];

    if (!conn || !conn.selected_resource) {
      return NextResponse.json(
        { error: "No Google Drive folder attached yet. Attach one in Connections first." },
        { status: 400 }
      );
    }

    const { accessToken, fresh } = await getAccessToken(conn);
    if (fresh) {
      await supabase
        .from("tenant_connections")
        .update({ encrypted_token: encodeTokenBundle(fresh) })
        .eq("id", conn.id);
    }

    // Pull the bytes server-side (public storage URL or external CDN).
    const src = await fetch(asset.url, { signal: AbortSignal.timeout(30_000) });
    if (!src.ok) {
      return NextResponse.json(
        { error: `Could not fetch the asset file (${src.status}).` },
        { status: 502 }
      );
    }
    const bytes = await src.arrayBuffer();

    const { name, mime } = filenameAndMime(asset.type, asset.url, asset.prompt);

    // Multipart upload into the attached folder.
    const form = new FormData();
    form.append(
      "metadata",
      new Blob(
        [JSON.stringify({ name, parents: [conn.selected_resource] })],
        { type: "application/json" }
      )
    );
    form.append("file", new Blob([bytes], { type: mime }));

    const driveRes = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: form,
        signal: AbortSignal.timeout(60_000),
      }
    );
    const driveData = (await driveRes.json().catch(() => ({}))) as {
      id?: string;
      name?: string;
      error?: { message?: string };
    };
    if (!driveRes.ok) {
      const msg = driveData.error?.message;
      throw new Error(msg ?? `Drive upload failed (${driveRes.status})`);
    }

    // Record the sync status on the asset so the library shows the badge.
    await supabase
      .from("media_assets")
      .update({
        drive_synced_at: new Date().toISOString(),
        drive_file_id: driveData.id ?? null,
        drive_error: null,
      })
      .eq("id", id)
      .eq("tenant_id", tenantId);

    return NextResponse.json({
      success: true,
      file: { id: driveData.id, name: driveData.name ?? name },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    // Remember the failure on the row (best-effort) so the library shows it.
    try {
      const tenantId = await getTenantId();
      const supabase = await createServiceClient();
      const { id } = await params;
      await supabase
        .from("media_assets")
        .update({ drive_error: message.slice(0, 500), drive_synced_at: null })
        .eq("id", id)
        .eq("tenant_id", tenantId);
    } catch {
      // best-effort
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
