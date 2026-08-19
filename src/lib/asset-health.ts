import path from "node:path";

/**
 * Shared per-workspace asset health smoke test.
 *
 * Used by the super-admin dashboard action (getAssetHealth) and the weekly
 * Inngest email (assetHealthWeeklyEmail) so the two can never drift apart.
 * For every media_assets row the URL is classified (empty / non-CDN / CDN)
 * and CDN assets are byte-checked against their stored extension, mirroring
 * the CI asset-integrity job (scripts/backfill-assets.cjs --verify).
 */

export interface WorkspaceAssetHealth {
  workspaceId: string | null;
  workspaceName: string;
  tenantId: string | null;
  tenantName: string;
  total: number;
  ok: number;
  broken: number;
  emptyUrl: number;
  nonCdn: number;
  /** Storage bytes actually served from the CDN during this check. */
  storageBytes: number;
  /** Rows whose Drive mirror succeeded (drive_synced_at set). */
  driveSynced: number;
  /** Rows whose Drive mirror failed and hasn't been retried yet. */
  driveFailed: number;
  /** Knowledgebase items whose Drive mirror succeeded. */
  kbDriveSynced: number;
  /** Knowledgebase items whose Drive mirror failed and hasn't been retried yet. */
  kbDriveFailed: number;
  checkedAt: string;
}

/** Human-readable byte count (e.g. "1.4 MB"). */
export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
}

export function sniffImageExt(buf: Buffer): string | null {
  if (!buf || buf.length < 4) return null;
  if (
    buf.length >= 8 &&
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return ".png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return ".jpg";
  if (buf.subarray(0, 4).toString("latin1") === "GIF8") return ".gif";
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString("latin1") === "RIFF" &&
    buf.subarray(8, 12).toString("latin1") === "WEBP"
  )
    return ".webp";
  const head = buf.subarray(0, 512).toString("latin1").trimStart().toLowerCase();
  if (head.startsWith("<svg") || head.startsWith("<?xml")) return ".svg";
  return null;
}

/**
 * Compute the per-workspace asset health summary. Expensive byte fetches run
 * with a small concurrency limit so a large library doesn't blow up a single
 * request or cron step.
 */
export async function computeAssetHealth(
  supabase: any
): Promise<WorkspaceAssetHealth[]> {
  const pullHost = (process.env.BUNNY_PULL_HOST || "agencyos.b-cdn.net")
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
  const cdnPrefix = `https://${pullHost}/`;

  const [{ data: assets }, { data: workspaces }, { data: tenants }, { data: kbItems }] =
    await Promise.all([
      supabase.from("media_assets").select("id, tenant_id, workspace_id, url, type, drive_synced_at, drive_error"),
      supabase.from("workspaces").select("id, tenant_id, name"),
      supabase.from("tenants").select("id, name"),
      supabase.from("knowledgebase_items").select("workspace_id, drive_synced_at, drive_error"),
    ]);

  const wsName = new Map<string, string>();
  for (const w of workspaces ?? []) wsName.set(w.id, w.name ?? "Unnamed");
  const tenantName = new Map<string, string>();
  for (const t of tenants ?? []) tenantName.set(t.id, t.name ?? "Unknown");

  // Classify each asset; CDN bytes are fetched + sniffed (bounded).
  const verdicts = new Map<
    string,
    { ok: number; broken: number; emptyUrl: number; nonCdn: number; storageBytes: number }
  >();
  const key = (wsId: string | null) => wsId ?? "(no workspace)";
  const fresh = () => ({ ok: 0, broken: 0, emptyUrl: 0, nonCdn: 0, storageBytes: 0 });

  const classify = (wsId: string | null, url: string | null) => {
    const v = verdicts.get(key(wsId)) ?? fresh();
    if (!url || url.trim() === "") v.emptyUrl++;
    else v.nonCdn++; // non-CDN (provider/legacy) URLs are never byte-checked
    verdicts.set(key(wsId), v);
  };

  // Byte-check CDN assets with a concurrency cap. A row is OK only when the
  // sniffed extension matches the stored one (MP4/ftyp accepted for videos).
  const cdnRows = (assets ?? []).filter((a: any) =>
    a.url && a.url.startsWith(cdnPrefix)
  );
  const CONCURRENCY = 8;
  let cursor = 0;
  const worker = async () => {
    while (cursor < cdnRows.length) {
      const row = cdnRows[cursor++];
      const wsId = row.workspace_id ?? null;
      const v = verdicts.get(key(wsId)) ?? fresh();
      try {
        const res = await fetch(row.url, { signal: AbortSignal.timeout(45000) });
        if (!res.ok) { v.broken++; verdicts.set(key(wsId), v); continue; }
        const body = Buffer.from(await res.arrayBuffer());
        if (body.length > 0) v.storageBytes += body.length;
        const pathPart = row.url.slice(cdnPrefix.length);
        const ext = path.extname(pathPart).toLowerCase();
        const isMp4 =
          body.length >= 12 && body.subarray(4, 8).toString("latin1") === "ftyp";
        const sniffed = sniffImageExt(body);
        if (body.length > 0 && ((sniffed && ext === sniffed) || (ext === ".mp4" && isMp4))) {
          v.ok++;
        } else {
          v.broken++;
        }
      } catch {
        v.broken++;
      }
      verdicts.set(key(wsId), v);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  // Non-CDN / empty rows were classified above without byte checks.
  for (const a of assets ?? []) {
    if (a.url && a.url.startsWith(cdnPrefix)) continue;
    classify(a.workspace_id ?? null, a.url);
  }

  // Drive mirror counts per workspace (no byte fetches — pure row flags).
  const drive = new Map<string, { synced: number; failed: number }>();
  for (const a of assets ?? []) {
    const wsKey = key(a.workspace_id ?? null);
    const d = drive.get(wsKey) ?? { synced: 0, failed: 0 };
    if (a.drive_synced_at) d.synced++;
    else if (a.drive_error) d.failed++;
    drive.set(wsKey, d);
  }

  // KB drive counts too, so the admin table covers failed KB mirrors as well
  // as media assets (a KB-only workspace with no media still shows up).
  const kbDrive = new Map<string, { synced: number; failed: number }>();
  for (const k of kbItems ?? []) {
    const wsKey = key(k.workspace_id ?? null);
    const d = kbDrive.get(wsKey) ?? { synced: 0, failed: 0 };
    if (k.drive_synced_at) d.synced++;
    else if (k.drive_error) d.failed++;
    kbDrive.set(wsKey, d);
  }

  const checkedAt = new Date().toISOString();
  const allKeys = new Set<string>([...verdicts.keys(), ...kbDrive.keys()]);
  const out: WorkspaceAssetHealth[] = [];
  for (const wsKey of allKeys) {
    const wsId = wsKey === "(no workspace)" ? null : wsKey;
    const wsRow = (workspaces ?? []).find((w: any) => w.id === wsId);
    const v = verdicts.get(wsKey) ?? fresh();
    const d = drive.get(wsKey) ?? { synced: 0, failed: 0 };
    const kd = kbDrive.get(wsKey) ?? { synced: 0, failed: 0 };
    out.push({
      workspaceId: wsId,
      workspaceName: wsRow?.name ?? (wsKey === "(no workspace)" ? "(no workspace)" : "Unnamed"),
      tenantId: wsRow?.tenant_id ?? null,
      tenantName: wsRow ? (tenantName.get(wsRow.tenant_id) ?? "Unknown") : "—",
      total: v.ok + v.broken + v.emptyUrl + v.nonCdn,
      ok: v.ok,
      broken: v.broken,
      emptyUrl: v.emptyUrl,
      nonCdn: v.nonCdn,
      storageBytes: v.storageBytes,
      driveSynced: d.synced,
      driveFailed: d.failed,
      kbDriveSynced: kd.synced,
      kbDriveFailed: kd.failed,
      checkedAt,
    });
  }
  out.sort((a, b) => a.tenantName.localeCompare(b.tenantName) || a.workspaceName.localeCompare(b.workspaceName));

  return out;
}
