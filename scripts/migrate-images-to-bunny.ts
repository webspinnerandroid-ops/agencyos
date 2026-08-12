/**
 * One-off migration: move existing media from Supabase Storage to Bunny.net.
 *
 * Objects live at media/{tenantId}/{uuid}.{ext} in both systems, so the
 * transfer is: download bytes from the Supabase public URL → PUT to the same
 * path on the Bunny zone → rewrite the URL prefix in media_assets.url and
 * posts.content. Idempotent — re-running skips rows already on the b-cdn host.
 *
 * Usage: npx tsx scripts/migrate-images-to-bunny.ts
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

// Minimal .env.local loader (dotenv is not a dependency here).
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const match = line.match(/^([A-Z0-9_]+)=\"?([^"\n]*)\"?$/);
  if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
}

const BUNNY_ZONE = process.env.BUNNY_STORAGE_ZONE ?? "agencyos";
const BUNNY_REGION = process.env.BUNNY_STORAGE_REGION ?? "la";
const BUNNY_KEY = process.env.BUNNY_STORAGE_API_KEY ?? "";
const BUNNY_PULL = (process.env.BUNNY_PULL_HOST ?? "agencyos.b-cdn.net").replace(/^https?:\/\//, "").replace(/\/+$/, "");
const BUNNY_UPLOAD = `https://${BUNNY_REGION}.storage.bunnycdn.com/${BUNNY_ZONE}`;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const SUPABASE_PREFIX =
  `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/media/`;
const BUNNY_PREFIX = `https://${BUNNY_PULL}/`;

async function transferObject(path: string): Promise<boolean> {
  // Fetch from Supabase storage (public object URL).
  const dl = await fetch(`${SUPABASE_PREFIX}${path}`);
  if (!dl.ok) {
    console.error(`  ✗ download failed ${path}: HTTP ${dl.status}`);
    return false;
  }
  const bytes = Buffer.from(await dl.arrayBuffer());
  const up = await fetch(`${BUNNY_UPLOAD}/${path}`, {
    method: "PUT",
    headers: {
      AccessKey: BUNNY_KEY,
      "Content-Type": dl.headers.get("content-type") ?? "image/png",
    },
    body: bytes,
  });
  if (!up.ok) {
    console.error(`  ✗ upload failed ${path}: HTTP ${up.status} ${up.statusText}`);
    return false;
  }
  return true;
}

async function main() {
  if (!BUNNY_KEY) {
    console.error("BUNNY_STORAGE_API_KEY is not set.");
    process.exit(1);
  }

  // Quick auth check before doing any work.
  const probe = await fetch(`${BUNNY_UPLOAD}/__migration_probe__.txt`, {
    method: "PUT",
    headers: { AccessKey: BUNNY_KEY, "Content-Type": "text/plain" },
    body: "probe",
  });
  if (probe.status === 401 || probe.status === 403) {
    console.error(
      `Bunny auth failed (HTTP ${probe.status}) — check BUNNY_STORAGE_API_KEY.`
    );
    process.exit(1);
  }
  if (probe.ok) {
    await fetch(`${BUNNY_UPLOAD}/__migration_probe__.txt`, {
      method: "DELETE",
      headers: { AccessKey: BUNNY_KEY },
    });
  }
  console.log("Bunny auth OK — transferring...");

  // --- media_assets ---
  let assets = 0;
  let offset = 0;
  const pageSize = 20;
  for (;;) {
    const { data: rows, error } = await supabase
      .from("media_assets")
      .select("id, url")
      .ilike("url", `${SUPABASE_PREFIX}%`)
      .order("id")
      .range(offset, offset + pageSize - 1);
    if (error) {
      console.error("[media_assets] fetch error:", error.message);
      break;
    }
    if (!rows || rows.length === 0) break;
    for (const row of rows as { id: string; url: string }[]) {
      const path = row.url.slice(SUPABASE_PREFIX.length);
      if (await transferObject(path)) {
        const { error: updErr } = await supabase
          .from("media_assets")
          .update({ url: `${BUNNY_PREFIX}${path}` })
          .eq("id", row.id);
        if (updErr) console.error(`  update ${row.id}:`, updErr.message);
        else assets++;
      }
    }
    offset += pageSize;
    if ((rows as unknown[]).length < pageSize) break;
    console.log(`  ...scanned ${offset} media_assets rows`);
  }
  console.log(`media_assets transferred: ${assets}`);

  // --- posts content (URL prefix swap; objects already transferred above) ---
  let posts = 0;
  offset = 0;
  const postPageSize = 2;
  for (;;) {
    const { data: rows, error } = await supabase
      .from("posts")
      .select("id, content")
      .eq("type", "blog")
      .order("id")
      .range(offset, offset + postPageSize - 1);
    if (error) {
      console.error("[posts] fetch error:", error.message, "(continuing)");
      break;
    }
    if (!rows || rows.length === 0) break;
    for (const row of rows as { id: string; content: any }[]) {
      if (!row.content || typeof row.content !== "object") continue;
      const text = JSON.stringify(row.content);
      if (!text.includes(SUPABASE_PREFIX)) continue;
      const updated = JSON.parse(text.split(SUPABASE_PREFIX).join(BUNNY_PREFIX));
      const { error: updErr } = await supabase
        .from("posts")
        .update({ content: updated })
        .eq("id", row.id);
      if (updErr) console.error(`  [posts] update ${row.id}:`, updErr.message);
      else {
        posts++;
        console.log(`  ✓ post ${row.id} — URLs rewritten to Bunny`);
      }
    }
    offset += postPageSize;
    if ((rows as unknown[]).length < postPageSize) break;
  }
  console.log(`posts rewritten: ${posts}`);
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
