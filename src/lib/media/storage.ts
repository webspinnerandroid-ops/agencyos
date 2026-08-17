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
  switch ((mime || "").toLowerCase()) {
    case "image/jpeg":
    case "image/jpg":
      return ".jpg";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    case "image/svg+xml":
      return ".svg";
    case "image/avif":
      return ".avif";
    case "image/png":
    default:
      return ".png";
  }
}

/**
 * Detect the real image format from the first bytes of the payload. The
 * content-type header can lie (or be missing), and Recraft V3's
 * vector_illustration style returns SVG — which was previously uploaded
 * under a `.png` path, producing an unrenderable card and a corrupt
 * "PNG" download. Sniffing the magic bytes keeps the extension honest.
 */
function sniffImageExt(buf: Buffer): string | null {
  if (!buf || buf.length < 4) return null;
  // PNG
  if (
    buf.length >= 8 &&
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return ".png";
  // JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return ".jpg";
  // GIF
  if (buf.subarray(0, 4).toString("latin1") === "GIF8") return ".gif";
  // WEBP (RIFF....WEBP)
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString("latin1") === "RIFF" &&
    buf.subarray(8, 12).toString("latin1") === "WEBP"
  )
    return ".webp";
  // AVIF (ftyp box)
  if (buf.subarray(4, 8).toString("latin1") === "ftyp") {
    const brand = buf.subarray(8, 12).toString("latin1");
    if (brand.includes("avif") || brand.includes("avis")) return ".avif";
  }
  // SVG — text that starts with <svg / <?xml (after optional whitespace)
  const head = buf.subarray(0, 512).toString("latin1").trimStart().toLowerCase();
  if (head.startsWith("<svg") || head.startsWith("<?xml")) return ".svg";
  return null;
}

export { sniffImageExt };

async function bunnyUpload(path: string, body: Buffer, contentType: string): Promise<boolean> {
  try {
    const res = await fetch(`${BUNNY_STORAGE_BASE}/${path}`, {
      method: "PUT",
      headers: {
        AccessKey: BUNNY_API_KEY,
        "Content-Type": contentType,
      },
      body,
      signal: AbortSignal.timeout(60_000),
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
 * - data: URLs (e.g. Google Imagen's base64 output) are uploaded to
 *   {tenantId}/{uuid}.{ext} and the CDN public URL is returned.
 * - http(s) URLs (hosted provider URLs — fal.ai, etc.) are SHORT-LIVED
 *   signed links that expire within hours. Left as-is, a saved image shows
 *   a broken card and a dead download link (exactly what happened on the
 *   Brand Design page). We download the bytes and re-upload them to the
 *   tenant's Bunny zone, returning the permanent CDN URL.
 *
 * On upload failure the original URL is returned rather than losing the
 * image — the DB stays consistent either way.
 */
export async function persistImageToStorage(
  tenantId: string,
  url: string
): Promise<string> {
  if (!url || typeof url !== "string") return url;
  // Already on our own CDN — nothing to do.
  if (url.startsWith(`https://${BUNNY_PULL_HOST}/`)) return url;

  if (isDataUrl(url)) {
    const match = url.match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/);
    if (!match) return url;

    const mime = match[1] || "image/png";
    const base64 = match[2] ? match[3] : decodeURIComponent(match[3]);
    const ext = extFromMime(mime);
    const path = `${tenantId}/${crypto.randomUUID()}${ext}`;

    const ok = await bunnyUpload(path, Buffer.from(base64, "base64"), mime);
    return ok ? storagePublicUrl(path) : url;
  }

  // Hosted provider URL (fal.ai etc.) — download + re-upload so the link
  // never expires. Mirrors persistVideoToStorage.
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) {
      console.warn("[storage] Image download failed:", res.status, url.slice(0, 120));
      return url;
    }
    const body = Buffer.from(await res.arrayBuffer());
    // Trust the bytes over the header: Recraft's vector output is SVG and
    // other providers may label PNG as octet-stream or vice-versa.
    const sniffed = sniffImageExt(body);
    const mime =
      sniffed === ".svg"
        ? "image/svg+xml"
        : res.headers.get("content-type")?.split(";")[0]?.trim() || "image/png";
    const ext = sniffed ?? extFromMime(mime);
    const path = `${tenantId}/${crypto.randomUUID()}${ext}`;
    const ok = await bunnyUpload(path, body, mime);
    return ok ? storagePublicUrl(path) : url;
  } catch (err) {
    console.warn("[storage] Image persist error:", err);
    return url;
  }
}

/**
 * Persists a generated video to Bunny storage.
 *
 * Provider URLs (fal.ai `*.fal.media`, DashScope, Runway) are usually
 * short-lived signed URLs that expire within hours — a library entry pointing
 * at them shows 0:00 and stops playing. This downloads the bytes and re-uploads
 * them to the tenant's Bunny zone, returning the permanent CDN URL. On any
 * failure the original URL is returned rather than losing the asset.
 *
 * Returns { url, sizeBytes } — the byte length is known from the download, so
 * callers can store it as the asset's file size without a second request.
 */
export async function persistVideoToStorage(
  tenantId: string,
  url: string
): Promise<{ url: string; sizeBytes: number | null }> {
  if (!url || typeof url !== "string") return { url, sizeBytes: null };
  // Data URLs (rare for video) pass through untouched.
  if (isDataUrl(url)) return { url, sizeBytes: null };
  // Already on our own CDN — nothing to do (size unknown without a HEAD).
  if (url.startsWith(`https://${BUNNY_PULL_HOST}/`)) {
    return { url, sizeBytes: null };
  }

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) {
      console.warn("[storage] Video download failed:", res.status, url.slice(0, 120));
      return { url, sizeBytes: null };
    }
    const body = Buffer.from(await res.arrayBuffer());
    const path = `videos/${crypto.randomUUID()}.mp4`;
    const ok = await bunnyUpload(`${tenantId}/${path}`, body, "video/mp4");
    return ok
      ? { url: storagePublicUrl(`${tenantId}/${path}`), sizeBytes: body.length }
      : { url, sizeBytes: null };
  } catch (err) {
    console.warn("[storage] Video persist error:", err);
    return { url, sizeBytes: null };
  }
}

/**
 * Uploads arbitrary bytes (PDFs, etc.) under {tenantId}/<path> and returns
 * the public CDN URL. Used for signed contracts and other non-image assets.
 * Returns null on failure.
 */
export async function uploadStoredFile(
  tenantId: string,
  path: string,
  body: Buffer,
  contentType: string
): Promise<string | null> {
  const fullPath = `${tenantId}/${path.replace(/^\//, "")}`;
  const ok = await bunnyUpload(fullPath, body, contentType);
  return ok ? storagePublicUrl(fullPath) : null;
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
