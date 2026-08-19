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

/** True when a Google API failure is worth retrying (network hiccup, 429
 * rate-limit, or a 5xx server error). Auth/4xx errors are NOT retried — they
 * need a human action (reconnect, re-consent, quota approval). */
export function isTransientDriveError(err: unknown, status?: number): boolean {
  if (status !== undefined) {
    return status === 429 || status >= 500;
  }
  // A thrown fetch error is a network/transport failure — transient by nature.
  const name = err instanceof Error ? err.name : "";
  return name !== "AbortError" && name !== "TimeoutError";
}

/** Sleep helper for backoff. */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Multipart-upload a byte buffer into a Drive folder.
 *
 * Retries transient failures (network, 429, 5xx) up to `retries` extra times
 * with exponential backoff + jitter before giving up — the caller records the
 * final error on the asset row. Callers that don't want retries pass retries: 0.
 */
export async function uploadBufferToDrive(
  folderId: string,
  accessToken: string,
  buffer: Buffer | ArrayBuffer,
  name: string,
  mime: string,
  opts: { retries?: number; baseDelayMs?: number } = {}
): Promise<{ id: string; name: string }> {
  const retries = opts.retries ?? 2;
  const baseDelayMs = opts.baseDelayMs ?? 1200;

  for (let attempt = 0; ; attempt++) {
    const form = new FormData();
    form.append(
      "metadata",
      new Blob([JSON.stringify({ name, parents: [folderId] })], {
        type: "application/json",
      })
    );
    form.append("file", new Blob([buffer], { type: mime }));

    let res: Response | null = null;
    try {
      res = await fetch(
        "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
        {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}` },
          body: form,
          signal: AbortSignal.timeout(60_000),
        }
      );
    } catch (err) {
      if (attempt < retries && isTransientDriveError(err)) {
        await sleep(baseDelayMs * 2 ** attempt + Math.random() * 300);
        continue;
      }
      throw err;
    }

    const data = (await res.json().catch(() => ({}))) as {
      id?: string;
      name?: string;
      error?: { message?: string };
    };
    if (!res.ok) {
      if (attempt < retries && isTransientDriveError(undefined, res.status)) {
        await sleep(baseDelayMs * 2 ** attempt + Math.random() * 300);
        continue;
      }
      throw new Error(data.error?.message ?? `Drive upload failed (${res.status})`);
    }
    return { id: data.id ?? "", name: data.name ?? name };
  }
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

    // Keep each client's media in their own subfolder under the attached
    // folder (falls back to the attached root on any subfolder hiccup).
    const targetFolderId =
      (await resolveDriveClientSubfolder(
        supabase,
        resolved.accessToken,
        resolved.folderId,
        opts.tenantId,
        opts.workspaceId
      )) ?? resolved.folderId;

    const file = await uploadBufferToDrive(
      targetFolderId,
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

    // Fetch the source bytes with a couple of retries for flaky CDN/storage
    // hosts — a transient hiccup here is exactly what the backoff exists for.
    let bytes: ArrayBuffer;
    try {
      bytes = await fetchWithRetry(asset.url, 2);
    } catch (err) {
      const msg = err instanceof Error ? err.message : `asset fetch failed`;
      await recordDriveFailure(supabase, asset.id, msg, asset.tenant_id);
      return { saved: false, skipped: msg };
    }

    // Keep each client's media in their own subfolder under the attached
    // folder (falls back to the attached root on any subfolder hiccup).
    const wsId =
      workspaceIdOverride !== undefined ? workspaceIdOverride : (asset.workspace_id ?? null);
    const targetFolderId =
      (await resolveDriveClientSubfolder(
        supabase,
        resolved.accessToken,
        resolved.folderId,
        asset.tenant_id,
        wsId
      )) ?? resolved.folderId;

    const { name, mime } = filenameAndMimeForAsset(asset.type, asset.url, asset.prompt);
    const file = await uploadBufferToDrive(
      targetFolderId,
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

/** Fetch a URL's bytes with retry-with-backoff on transient failures. */
async function fetchWithRetry(url: string, retries: number): Promise<ArrayBuffer> {
  let lastErr: unknown;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (res.ok) return await res.arrayBuffer();
      if (attempt >= retries || !isTransientDriveError(undefined, res.status)) {
        throw new Error(`asset fetch failed (${res.status})`);
      }
    } catch (err) {
      lastErr = err;
      if (attempt >= retries || !isTransientDriveError(err)) throw err;
    }
    await sleep(800 * 2 ** attempt + Math.random() * 200);
  }
}

/**
 * Mirror a knowledgebase item's stored file into the attached Drive folder,
 * inside a per-client subfolder named after the workspace. Both the auto-save
 * path and the manual "save to Drive" action call this — it downloads the
 * stored bytes, uploads into the resolved subfolder, and records the outcome
 * on the knowledgebase_items row (drive_synced_at / drive_file_id /
 * drive_error) so the UI can show a sync badge + one-click retry. Never throws.
 */
export async function mirrorKnowledgebaseFileToDrive(opts: {
  tenantId: string;
  workspaceId: string | null;
  itemId: string;
  storagePath: string;
  name: string;
  mime: string;
}): Promise<{ saved: boolean; skipped?: string; file?: { id: string; name: string } }> {
  try {
    const resolved = await resolveWorkspaceDriveConnection(
      opts.tenantId,
      opts.workspaceId
    );
    if (!resolved.ok) {
      await recordKbDriveFailure(opts.tenantId, opts.itemId, resolved.error);
      return { saved: false, skipped: resolved.error };
    }

    const supabase = resolved.supabase;

    // Keep each client's files in their own subfolder rather than dumping
    // everything into the root of the attached Drive folder. Any subfolder
    // hiccup falls back to the attached root so files still mirror.
    const targetFolderId =
      (await resolveDriveClientSubfolder(
        supabase,
        resolved.accessToken,
        resolved.folderId,
        opts.tenantId,
        opts.workspaceId
      )) ?? resolved.folderId;

    const { data: blob, error: dlErr } = await supabase.storage
      .from("tenant-assets")
      .download(opts.storagePath);
    if (dlErr || !blob) {
      const msg = `could not read stored file: ${dlErr?.message ?? "not found"}`;
      await recordKbDriveFailure(opts.tenantId, opts.itemId, msg);
      return { saved: false, skipped: msg };
    }
    const buffer = Buffer.from(await blob.arrayBuffer());

    const file = await uploadBufferToDrive(
      targetFolderId,
      resolved.accessToken,
      buffer,
      opts.name,
      opts.mime
    );

    await supabase
      .from("knowledgebase_items")
      .update({
        drive_synced_at: new Date().toISOString(),
        drive_file_id: file.id,
        drive_error: null,
      })
      .eq("id", opts.itemId)
      .eq("tenant_id", opts.tenantId);
    return { saved: true, file };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    try {
      await recordKbDriveFailure(opts.tenantId, opts.itemId, msg);
    } catch {
      // status write is best-effort — the sync failure itself is the news
    }
    return { saved: false, skipped: msg };
  }
}

/**
 * Auto-save wrapper: mirrors a freshly uploaded knowledgebase file into Drive
 * only when the workspace's auto-save toggle is on. Fire-and-forget from the
 * upload path — a missing connection/toggle just skips (no error recorded).
 */
export async function autoSaveKnowledgebaseFileToDrive(opts: {
  tenantId: string;
  workspaceId: string | null;
  itemId: string;
  storagePath: string;
  name: string;
  mime: string;
}): Promise<{ saved: boolean; skipped?: string; file?: { id: string; name: string } }> {
  try {
    const resolved = await resolveWorkspaceDriveConnection(
      opts.tenantId,
      opts.workspaceId
    );
    if (!resolved.ok) return { saved: false, skipped: resolved.error };

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
  } catch (err) {
    return { saved: false, skipped: err instanceof Error ? err.message : String(err) };
  }

  return mirrorKnowledgebaseFileToDrive(opts);
}

/**
 * Find-or-create a per-client subfolder (named after the workspace) inside the
 * attached Drive folder. Returns null on any failure so callers fall back to
 * the attached root instead of dropping the mirror.
 */
async function resolveDriveClientSubfolder(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  accessToken: string,
  rootFolderId: string,
  tenantId: string,
  workspaceId: string | null
): Promise<string | null> {
  if (!workspaceId) return null;
  try {
    const { data: ws } = await supabase
      .from("workspaces")
      .select("name")
      .eq("id", workspaceId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    const name = sanitizeDriveFolderName((ws as { name?: string } | null)?.name ?? "Workspace");

    const q = encodeURIComponent(
      `'${rootFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and name = '${name.replace(/'/g, "\\'")}' and trashed = false`
    );
    const listRes = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=10`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(20_000),
      }
    );
    if (listRes.ok) {
      const data = (await listRes.json().catch(() => ({}))) as {
        files?: { id: string; name: string }[];
      };
      const existing = data.files?.find((f) => f.name === name);
      if (existing?.id) return existing.id;
    }

    const createRes = await fetch("https://www.googleapis.com/drive/v3/files", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name,
        mimeType: "application/vnd.google-apps.folder",
        parents: [rootFolderId],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!createRes.ok) return null;
    const created = (await createRes.json().catch(() => ({}))) as { id?: string };
    return created.id ?? null;
  } catch {
    return null;
  }
}

/** Drive folder names can't contain a slash; keep them single-line + bounded. */
function sanitizeDriveFolderName(name: string): string {
  return (
    (name || "Workspace")
      .replace(/[/\\]/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || "Workspace"
  );
}

async function recordKbDriveFailure(
  tenantId: string,
  itemId: string,
  message: string
): Promise<void> {
  const supabase = await createServiceClient();
  await supabase
    .from("knowledgebase_items")
    .update({ drive_error: message.slice(0, 500), drive_synced_at: null })
    .eq("id", itemId)
    .eq("tenant_id", tenantId);
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
