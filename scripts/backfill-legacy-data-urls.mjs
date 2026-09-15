/**
 * One-off backfill: rewrite a legacy post's base64 data-URL images to
 * hosted CDN URLs (migration to Bunny storage via persistImageToStorage).
 *
 *   node --env-file=.env.local scripts/backfill-legacy-data-urls.mjs [--all]
 *
 * Default: processes only the single largest post row. --all sweeps every
 * row with data-URL images.
 */
import { createClient } from "@supabase/supabase-js";

// persistImageToStorage is TypeScript; inline the same logic for this
// one-off script (Bunny PUT + public URL), using the same env vars.
const BUNNY_API_KEY = process.env.BUNNY_STORAGE_API_KEY ?? "";
const BUNNY_REGION = process.env.BUNNY_STORAGE_REGION ?? "uk";
const BUNNY_ZONE = process.env.BUNNY_STORAGE_ZONE_NAME ?? process.env.BUNNY_STORAGE_ZONE ?? "";
const BUNNY_PULL_HOST = process.env.BUNNY_PULL_HOST ?? "agencyos.b-cdn.net";
const BUNNY_STORAGE_BASE = `https://${BUNNY_REGION}.storage.bunnycdn.com/${BUNNY_ZONE}`;

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const isDataUrl = (u) => typeof u === "string" && /^data:image\//i.test(u);
const extFromMime = (m) =>
  ({ "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif" })[m] ?? ".png";

async function persist(url, tenantId) {
  const match = url.match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/);
  if (!match) return url;
  const mime = match[1] || "image/png";
  const base64 = match[2] ? match[3] : decodeURIComponent(match[3]);
  const ext = extFromMime(mime);
  const path = `${tenantId}/${crypto.randomUUID()}${ext}`;
  const res = await fetch(`${BUNNY_STORAGE_BASE}/${path}`, {
    method: "PUT",
    headers: { AccessKey: BUNNY_API_KEY, "Content-Type": mime },
    body: Buffer.from(base64, "base64"),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`Bunny upload failed: ${res.status}`);
  return `https://${BUNNY_PULL_HOST}/${path}`;
}

async function backfillPost(post) {
  const content = post.content ?? {};
  let changed = 0;

  const images = Array.isArray(content.images) ? content.images : [];
  for (const img of images) {
    if (img && isDataUrl(img.url)) {
      img.url = await persist(img.url, post.tenant_id);
      changed++;
    }
  }

  let body = typeof content.body === "string" ? content.body : "";
  if (body.includes("data:image")) {
    const seen = new Map();
    body = body.replace(/data:image\/[a-zA-Z+]+;base64,[A-Za-z0-9+/=]+/g, (m) => {
      // The same data URL can appear twice (images[] + <img src>) — upload once.
      if (!seen.has(m)) {
        seen.set(m, null); // placeholder; filled below
      }
      return m; // replace after uploads complete
    });
    for (const [dataUrl] of seen) {
      seen.set(dataUrl, await persist(dataUrl, post.tenant_id));
      changed++;
    }
    for (const [dataUrl, hosted] of seen) {
      body = body.split(dataUrl).join(hosted);
    }
  }

  if (changed === 0) return { changed, sizeBefore: 0, sizeAfter: 0 };

  const sizeBefore = JSON.stringify(content).length;
  content.body = body;
  const { error } = await sb.from("posts").update({ content }).eq("id", post.id);
  if (error) throw new Error(`DB update failed: ${error.message}`);
  return { changed, sizeBefore, sizeAfter: JSON.stringify(content).length };
}

const ALL = process.argv.includes("--all");
const { data: posts, error } = await sb
  .from("posts")
  .select("id, tenant_id, created_at, content->>title, content")
  .order("created_at", { ascending: false })
  .limit(400);
if (error) {
  console.error("Fetch failed:", error.message);
  process.exit(1);
}

let targets = (posts ?? []).filter(
  (p) =>
    (Array.isArray(p.content?.images) && p.content.images.some((i) => isDataUrl(i?.url))) ||
    (typeof p.content?.body === "string" && p.content.body.includes("data:image"))
);
if (!ALL && targets.length > 0) {
  targets = [targets.reduce((a, b) => (JSON.stringify(b.content).length > JSON.stringify(a.content).length ? b : a))];
}

console.log(`Targets: ${targets.length}`);
for (const post of targets) {
  try {
    const r = await backfillPost(post);
    console.log(
      `${r.changed ? "DONE" : "SKIP"} ${post.id} "${post.title}" — ${r.changed} image(s) uploaded, ${(r.sizeBefore / 1024 / 1024).toFixed(1)}MB → ${(r.sizeAfter / 1024 / 1024).toFixed(1)}MB`
    );
  } catch (err) {
    console.error(`FAIL ${post.id}:`, err.message);
  }
}
