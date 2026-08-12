/**
 * Media storage layer — Bunny.net.
 *
 * Generated images were originally stored as base64 data-URLs inside Postgres
 * (50 MB "Recent Images" payloads, 8 MB posts), then moved to Supabase
 * Storage. This layer uploads to a **Bunny.net storage zone** and serves via
 * its CDN pull zone — cheap (≈$10/TB/mo) and edge-cached worldwide. The DB
 * stores only the short public URL.
 *
 * Env vars:
 *   BUNNY_STORAGE_ZONE    — storage zone name (e.g. "agencyos")
 *   BUNNY_STORAGE_REGION  — storage zone region code (e.g. "la", "ny", "de")
 *   BUNNY_STORAGE_API_KEY — storage zone API key (Storage → API Access)
 *   BUNNY_PULL_HOST       — pull zone hostname (e.g. "agencyos.b-cdn.net")
 *
 * Everything image-writing flows through persistImageToStorage, so swapping
 * backends is a single-file change.
 */

const BUNNY_STORAGE_ZONE = process.env.BUNNY_STORAGE_ZONE ?? "agencyos";
const BUNNY_STORAGE_REGION = process.env.BUNNY_STORAGE_REGION ?? "la";
const BUNNY_API_KEY = process.env.BUNNY_STORAGE_API_KEY ?? "";
const BUNNY_PULL_HOST = (
  process.env.BUNNY_PULL_HOST ?? "agencyos.b-cdn.net"
)
  .replace(/^https?:\/\//, "")
  .replace(/\/+$/, "");

/** Upload API base: https://{region}.storage.bunnycdn.com/{zone} */
const BUNNY_STORAGE_BASE = `https://${BUNNY_STORAGE_REGION}.storage.bunnycdn.com/${BUNNY_STORAGE_ZONE}`;

/** Public URL for an object path via the pull zone (CDN). */
export function storagePublicUrl(path: string): string {
  return `https://${BUNNY_PULL_HOST}/${path}`;
}

/** Legacy no-op kept for old scripts — Bunny needs no bucket setup. */
export function ensureMediaBucket(): Promise<boolean> {
  return Promise.resolve(true);
}

export function isDataUrl(url: string): boolean {
  return typeof url === "string" && url.startsWith("data:");
}

function extFromMime(mime: string): string {
  switch (mime) {
    case "image/jpeg":
      return ".jpg";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    case "image/png":
    default:
      return ".png";
  }
}

async function bunnyUpload(path: string, body: Buffer, contentType: string): Promise<boolean> {
  try {
    const res = await fetch(`${BUNNY_STORAGE_BASE}/${path}`, {
      method: "PUT",
      headers: {
        AccessKey: BUNNY_API_KEY,
        "Content-Type": contentType,
      },
      body,
    });
    if (!res.ok) {
      console.error(
        "[storage] Bunny upload failed:",
        res.status,
        res.statusText,
        path
      );
      return false;
    }
    return true;
  } catch (err) {
    console.error("[storage] Bunny upload error:", err);
    return false;
  }
}

/**
 * Persists an image to Bunny storage.
 *
 * - http(s) URLs (hosted provider URLs) pass through untouched.
 * - data: URLs (e.g. Google Imagen's base64 output) are uploaded to
 *   {tenantId}/{uuid}.{ext} and the CDN public URL is returned.
 *
 * On upload failure the original URL is returned rather than losing the
 * image — the DB stays consistent either way.
 */
export async function persistImageToStorage(
  tenantId: string,
  url: string
): Promise<string> {
  if (!isDataUrl(url)) return url;

  const match = url.match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/);
  if (!match) return url;

  const mime = match[1] || "image/png";
  const base64 = match[2] ? match[3] : decodeURIComponent(match[3]);
  const ext = extFromMime(mime);
  const path = `${tenantId}/${crypto.randomUUID()}${ext}`;

  const ok = await bunnyUpload(path, Buffer.from(base64, "base64"), mime);
  return ok ? storagePublicUrl(path) : url;
}

/**
 * Deletes an object given its public URL. No-op for URLs outside this
 * pull zone (remote URLs, plain data URLs).
 */
export async function deleteStoredImage(publicUrl: string): Promise<void> {
  const prefix = `https://${BUNNY_PULL_HOST}/`;
  if (!publicUrl.startsWith(prefix)) return;
  const path = publicUrl.slice(prefix.length);
  try {
    const res = await fetch(`${BUNNY_STORAGE_BASE}/${path}`, {
      method: "DELETE",
      headers: { AccessKey: BUNNY_API_KEY },
    });
    if (!res.ok) {
      console.error("[storage] Bunny delete failed:", res.status, path);
    }
  } catch (err) {
    console.error("[storage] Bunny delete error:", err);
  }
}
