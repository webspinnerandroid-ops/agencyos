/**
 * Shared Google Drive upload plumbing, used by the per-asset "Save to Drive"
 * action, the auto-save toggle, and the knowledgebase file export.
 *
 * The workspace's Drive connection lives in tenant_connections
 * (provider = 'google_drive', selected_resource = folder id). The token is
 * AES-encrypted there; getAccessToken() refreshes it transparently.
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
