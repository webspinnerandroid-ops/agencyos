/**
 * One-off migration: move base64 data-URL images out of Postgres and into
 * Supabase Storage.
 *
 * media_assets.url and posts.content stored Google Imagen's ~2-3 MB base64
 * data-URLs directly in rows — a 20-image Recent Images response was 50 MB
 * (25s loads), and blog posts ballooned to megabytes. This script uploads
 * each unique data URL once and rewrites the rows to hold only the short
 * public storage URL.
 *
 * Usage: npx tsx scripts/migrate-images-to-storage.ts [--posts]
 *   (--posts also migrates base64 inside posts.content; default: media_assets only)
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import {
  ensureMediaBucket,
  persistImageToStorage,
  isDataUrl,
} from "../src/lib/media/storage";

// Minimal .env.local loader (dotenv is not a dependency here).
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const match = line.match(/^([A-Z0-9_]+)=\"?([^"\n]*)\"?$/);
  if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const includePosts = process.argv.includes("--posts");

/** Dedupe: identical data URLs (same image embedded in body + images array) upload once. */
const urlCache = new Map<string, string>();

async function persistCached(tenantId: string, url: string): Promise<string> {
  if (!isDataUrl(url)) return url;
  const cached = urlCache.get(url);
  if (cached) return cached;
  const stored = await persistImageToStorage(tenantId, url);
  urlCache.set(url, stored);
  return stored;
}

async function migrateMediaAssets(): Promise<number> {
  let migrated = 0;
  let offset = 0;
  const pageSize = 20;
  for (;;) {
    const { data: rows, error } = await supabase
      .from("media_assets")
      .select("id, tenant_id, url")
      .order("id")
      .range(offset, offset + pageSize - 1);
    if (error) {
      console.error("[media_assets] fetch error:", error.message);
      break;
    }
    if (!rows || rows.length === 0) break;
    for (const row of rows as { id: string; tenant_id: string; url: string }[]) {
      if (!isDataUrl(row.url)) continue;
      const newUrl = await persistCached(row.tenant_id, row.url);
      if (newUrl === row.url) continue; // upload failed — leave as-is
      const { error: updErr } = await supabase
        .from("media_assets")
        .update({ url: newUrl })
        .eq("id", row.id);
      if (updErr) {
        console.error(`[media_assets] update ${row.id} failed:`, updErr.message);
      } else {
        migrated++;
      }
    }
    offset += pageSize;
    if ((rows as unknown[]).length < pageSize) break;
    console.log(`  ...scanned ${offset} media_assets rows`);
  }
  return migrated;
}

async function migratePosts(): Promise<number> {
  let migrated = 0;
  let offset = 0;
  // Posts' content can be megabytes each (base64 bodies), so a 10-row chunk
  // trips PostgREST's statement timeout. Two at a time stays well under it.
  const pageSize = 2;
  for (;;) {
    const { data: rows, error } = await supabase
      .from("posts")
      .select("id, tenant_id, content")
      .eq("type", "blog")
      .order("id")
      .range(offset, offset + pageSize - 1);
    if (error) {
      console.error("[posts] fetch error:", error.message, "(continuing)");
      break;
    }
    if (!rows || rows.length === 0) break;
    for (const row of rows as { id: string; tenant_id: string; content: any }[]) {
      const content = row.content;
      if (!content || typeof content !== "object") continue;
      const body: string = content.body ?? "";
      const images: { url: string }[] = Array.isArray(content.images)
        ? (content.images as { url: string }[])
        : [];

      // Collect every data URL in the body + images array.
      const found = new Set<string>();
      const bodyRe = /!\[[^\]]*\]\((data:[^)]+)\)/g;
      for (const m of body.matchAll(bodyRe)) found.add(m[1]);
      for (const img of images) if (isDataUrl(img.url)) found.add(img.url);

      if (found.size === 0) continue;

      let changed = false;
      let newBody = body;
      let newImages = images;
      for (const dataUrl of found) {
        const newUrl = await persistCached(row.tenant_id, dataUrl);
        if (newUrl === dataUrl) continue;
        newBody = newBody.split(dataUrl).join(newUrl);
        newImages = newImages.map((img) =>
          img.url === dataUrl ? { ...img, url: newUrl } : img
        );
        changed = true;
      }

      if (!changed) continue;
      const { error: updErr } = await supabase
        .from("posts")
        .update({ content: { ...content, body: newBody, images: newImages } })
        .eq("id", row.id);
      if (updErr) {
        console.error(`[posts] update ${row.id} failed:`, updErr.message);
      } else {
        migrated++;
        console.log(`  ✓ post ${row.id} — ${found.size} image(s) moved to storage`);
      }
    }
    offset += pageSize;
    if ((rows as unknown[]).length < pageSize) break;
    console.log(`  ...scanned ${offset} blog posts`);
  }
  return migrated;
}

async function main() {
  console.log("Ensuring media bucket exists...");
  const ok = await ensureMediaBucket();
  if (!ok) {
    console.error("Could not ensure the media bucket — aborting.");
    process.exit(1);
  }

  console.log("Migrating media_assets...");
  const assets = await migrateMediaAssets();
  console.log(`media_assets: ${assets} row(s) migrated`);

  if (includePosts) {
    console.log("Migrating blog post content...");
    const posts = await migratePosts();
    console.log(`posts: ${posts} row(s) migrated`);
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
