/**
 * Shared Google Drive upload plumbing, used by the per-asset "Save to Drive"
 * action, the auto-save toggle, and the knowledgebase file export.
 *
 * The workspace's Drive connection lives in tenant_connections
 * (provider = 'google_drive', selected_resource = folder id). The token is
 * AES-encrypted there; getAccessToken() refreshes it transparently.
 *
 * Per-asset sync status lives on media_assets:
 *   drive_synced_at / drive_file_id / drive_error
 */
import { createServiceClient } from "@/lib/supabase/server";
import {
  type ConnectionRecord,
  encodeTokenBundle,
  getAccessToken,
} from "@/lib/connections";

type DriveConn = ConnectionRecord & { auto_save_to_drive?: boolean | null };

/** Resolve the workspace's Drive connection + a fresh access token. */
export async function resolveWorkspaceDriveConnection(
  tenantId: string,
  workspaceId: string | null
): Promise<
  | { ok: true; accessToken: string; folderId: string; supabase: Awaited<ReturnType<typeof createServiceClient>> }
  | { ok: false; error: string }
> {
  const supabase = await createServiceClient();
  const { data, error } = await supabase
    .from("tenant_connections")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("provider", "google_drive");

  if (error) return { ok: false, error: error.message };

  const rows = (data ?? []) as DriveConn[];
  const conn = workspaceId
    ? rows.find((r) => r.workspace_id === workspaceId) ??
      rows.find((r) => !r.workspace_id) ??
      rows[0]
    : rows[0];

  if (!conn) {
    return { ok: false, error: "Google Drive is not connected yet." };
  }
  if (!conn.selected_resource) {
    return {
      ok: false,
      error: "No Google Drive folder attached yet. Attach one in Connections first.",
    };
  }

  const { accessToken, fresh } = await getAccessToken(conn);
  if (fresh) {
    await supabase
      .from("tenant_connections")
      .update({ encrypted_token: encodeTokenBundle(fresh) })
      .eq("id", conn.id);
  }

  return { ok: true, accessToken, folderId: conn.selected_resource, supabase };
}

/** Pick a sane filename + mime from the asset type and its URL extension. */
export function filenameAndMimeForAsset(
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

  const slug =
    (prompt || "asset").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) ||
    "asset";
  return { name: `${slug}.${ext}`, mime };
}

/** Multipart-upload a byte buffer into a Drive folder. */
export async function uploadBufferToDrive(
  folderId: string,
  accessToken: string,
  buffer: Buffer | ArrayBuffer,
  name: string,
  mime: string
): Promise<{ id: string; name: string }> {
  const form = new FormData();
  form.append(
    "metadata",
    new Blob([JSON.stringify({ name, parents: [folderId] })], {
      type: "application/json",
    })
  );
  form.append("file", new Blob([buffer], { type: mime }));

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      body: form,
      signal: AbortSignal.timeout(60_000),
    }
  );
  const data = (await res.json().catch(() => ({}))) as {
    id?: string;
    name?: string;
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new Error(data.error?.message ?? `Drive upload failed (${res.status})`);
  }
  return { id: data.id ?? "", name: data.name ?? name };
}

/**
 * Mirror a generated asset's URL into the attached Drive folder when the
 * workspace has auto-save enabled. Safe to fire-and-forget: every failure is
 * returned (not thrown) so a missing connection never breaks generation.
 */
// (autoSaveUrlToDrive unchanged below — status-aware flow lives in syncAssetToDrive)
export async function autoSaveUrlToDrive(opts: {
  tenantId: string;
  workspaceId: string | null;
  url: string;
  name: string;
  mime: string;
}): Promise<{ saved: boolean; skipped?: string; file?: { id: string; name: string } }> {
  try {
    const resolved = await resolveWorkspaceDriveConnection(
      opts.tenantId,
      opts.workspaceId
    );
    if (!resolved.ok) return { saved: false, skipped: resolved.error };

    // Only mirror when the owner flipped the toggle.
    const supabase = resolved.supabase;
    const { data: row } = await supabase
      .from("tenant_connections")
      .select("auto_save_to_drive")
      .eq("provider", "google_drive")
      .eq("tenant_id", opts.tenantId)
      .eq("selected_resource", resolved.folderId)
      .maybeSingle();
    if (!(row as { auto_save_to_drive?: boolean } | null)?.auto_save_to_drive) {
      return { saved: false, skipped: "auto-save off" };
    }

    const src = await fetch(opts.url, { signal: AbortSignal.timeout(30_000) });
    if (!src.ok) return { saved: false, skipped: `asset fetch failed (${src.status})` };
    const bytes = await src.arrayBuffer();

    const file = await uploadBufferToDrive(
      resolved.folderId,
      resolved.accessToken,
      bytes,
      opts.name,
      opts.mime
    );
    return { saved: true, file };
  } catch (err) {
    return { saved: false, skipped: err instanceof Error ? err.message : String(err) };
  }
}

/** A media_assets row with the columns syncAssetToDrive needs. */
export interface DriveSyncAsset {
  id: string;
  tenant_id: string;
  workspace_id?: string | null;
  type: string;
  prompt: string;
  url?: string | null;
  drive_synced_at?: string | null;
}

/**
 * Status-aware Drive sync for a media_assets row (images, brand assets,
 * videos, voice clips). Skips rows that already synced, only runs when the
 * workspace's auto-save toggle is on, and records the outcome on the row
 * (drive_synced_at / drive_file_id / drive_error) so the Asset Library can
 * show which files mirrored and which failed. Never throws.
 */
export async function syncAssetToDrive(
  asset: DriveSyncAsset,
  workspaceIdOverride?: string | null
): Promise<{ saved: boolean; skipped?: string; file?: { id: string; name: string } }> {
  if (!asset.url) return { saved: false, skipped: "no url yet" };
  if (asset.drive_synced_at) return { saved: false, skipped: "already synced" };

  try {
    const resolved = await resolveWorkspaceDriveConnection(
      asset.tenant_id,
      workspaceIdOverride !== undefined ? workspaceIdOverride : (asset.workspace_id ?? null)
    );
    if (!resolved.ok) return { saved: false, skipped: resolved.error };

    const supabase = resolved.supabase;
    const { data: row } = await supabase
      .from("tenant_connections")
      .select("auto_save_to_drive")
      .eq("provider", "google_drive")
      .eq("tenant_id", asset.tenant_id)
      .eq("selected_resource", resolved.folderId)
      .maybeSingle();
    if (!(row as { auto_save_to_drive?: boolean } | null)?.auto_save_to_drive) {
      return { saved: false, skipped: "auto-save off" };
    }

    const src = await fetch(asset.url, { signal: AbortSignal.timeout(30_000) });
    if (!src.ok) {
      const msg = `asset fetch failed (${src.status})`;
      await recordDriveFailure(supabase, asset.id, msg, asset.tenant_id);
      return { saved: false, skipped: msg };
    }
    const bytes = await src.arrayBuffer();

    const { name, mime } = filenameAndMimeForAsset(asset.type, asset.url, asset.prompt);
    const file = await uploadBufferToDrive(
      resolved.folderId,
      resolved.accessToken,
      bytes,
      name,
      mime
    );

    await supabase
      .from("media_assets")
      .update({
        drive_synced_at: new Date().toISOString(),
        drive_file_id: file.id,
        drive_error: null,
      })
      .eq("id", asset.id)
      .eq("tenant_id", asset.tenant_id);
    return { saved: true, file };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    try {
      const supabase = await createServiceClient();
      await recordDriveFailure(supabase, asset.id, msg, asset.tenant_id);
    } catch {
      // status write is best-effort — the sync failure itself is the news
    }
    return { saved: false, skipped: msg };
  }
}

async function recordDriveFailure(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  assetId: string,
  message: string,
  tenantId: string
): Promise<void> {
  await supabase
    .from("media_assets")
    .update({ drive_error: message.slice(0, 500), drive_synced_at: null })
    .eq("id", assetId)
    .eq("tenant_id", tenantId);
}
