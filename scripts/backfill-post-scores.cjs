// Backfill metadata.postId + metadata.scores onto existing content-generated
// images. When the "compare scores" stamping was added to the generate-content
// route (commit 5d814ac), it only applied to NEW generations. This script
// walks every blog post that carries SEO/AEO/GEO scores, finds the images it
// references (content.images[].url), and stamps the same
// { postId, scores: { seo, aeo, geo, gate } } metadata onto the matching
// media_assets rows so the Asset Library cards get their compare-scores links.
//
// Matching:
//   1. Exact URL match first (both the post and media_assets hold the same
//      Bunny CDN URL).
//   2. Fallback: unique prompt match (same tenant, type image) for legacy rows
//      whose stored URL is an expired provider link that was since re-uploaded.
//
// Idempotent — rows that already have metadata.postId are skipped. No secrets
// printed. Safe to re-run.
const fs = require("fs");
const path = require("path");

function loadEnv(file) {
  const out = {};
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

const DRY = process.argv.includes("--dry");

(async () => {
  const env = { ...loadEnv(path.join(__dirname, "..", ".env.local")), ...process.env };
  const { createClient } = require("@supabase/supabase-js");
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  const gate = Number(env.SEO_SCORE_PUBLISH_MIN) || 80;

  // ------------------------------------------------------------------
  // 1. Collect every blog post image URL with its post's scores.
  // ------------------------------------------------------------------
  const urlToPost = new Map(); // url -> { postId, seo, aeo, geo, gate }
  const promptToPost = new Map(); // `${tenantId}|${prompt}` -> post info (only if unique)
  let postsScanned = 0;
  let offset = 0;
  const PAGE = 200;

  for (;;) {
    const { data, error } = await sb
      .from("posts")
      .select("id, tenant_id, content")
      .order("created_at", { ascending: false })
      .range(offset, offset + PAGE - 1);

    if (error) {
      console.error("Post query error:", error.message);
      process.exit(1);
    }
    if (!data || data.length === 0) break;

    for (const row of data) {
      const c = typeof row.content === "string" ? JSON.parse(row.content || "{}") : (row.content ?? {});
      if (c?.type !== "blog") continue;
      const seo = c?.seo?.score;
      const aeo = c?.aeoGeo?.aeoScore;
      const geo = c?.aeoGeo?.geoScore;
      if (typeof seo !== "number" || typeof aeo !== "number" || typeof geo !== "number") continue;

      postsScanned++;
      const info = { postId: row.id, seo, aeo, geo, gate };
      for (const img of Array.isArray(c?.images) ? c.images : []) {
        if (!img || typeof img.url !== "string" || !img.url) continue;
        if (!urlToPost.has(img.url)) urlToPost.set(img.url, info);
        const key = `${row.tenant_id}|${img.prompt ?? ""}`;
        if (img.prompt && !promptToPost.has(key)) promptToPost.set(key, info);
        else if (img.prompt) promptToPost.set(key, null); // ambiguous — skip
      }
    }

    if (data.length < PAGE) break;
    offset += PAGE;
  }

  console.log(`Posts with scores scanned: ${postsScanned}; image URLs indexed: ${urlToPost.size}`);

  // ------------------------------------------------------------------
  // 2. Walk media_assets without postId and stamp matching rows.
  // ------------------------------------------------------------------
  let stamped = 0;
  let skipped = 0;
  offset = 0;

  for (;;) {
    const { data, error } = await sb
      .from("media_assets")
      .select("id, tenant_id, url, prompt, metadata, type")
      .order("created_at", { ascending: false })
      .range(offset, offset + PAGE - 1);

    if (error) {
      console.error("Asset query error:", error.message);
      process.exit(1);
    }
    if (!data || data.length === 0) break;

    for (const row of data) {
      const meta = (row.metadata ?? {}) && typeof row.metadata === "object" ? row.metadata : {};
      if (meta.postId) { skipped++; continue; }

      let info = row.url ? urlToPost.get(row.url) : null;
      if (!info && row.prompt) {
        info = promptToPost.get(`${row.tenant_id}|${row.prompt}`) ?? null;
      }
      if (!info) { skipped++; continue; }

      stamped++;
      if (DRY) {
        console.log(`  [stamp] ${row.id.slice(0, 8)} → post=${info.postId.slice(0, 8)} seo=${info.seo} aeo=${info.aeo} geo=${info.geo}`);
        continue;
      }
      const { error: updErr } = await sb
        .from("media_assets")
        .update({
          metadata: {
            ...meta,
            postId: info.postId,
            scores: {
              seo: info.seo,
              aeo: info.aeo,
              geo: info.geo,
              gate: info.gate,
            },
          },
        })
        .eq("id", row.id);
      if (updErr) {
        console.error(`  [stamp] FAILED ${row.id}: ${updErr.message}`);
      } else {
        console.log(`  [stamp] ${row.id.slice(0, 8)} → post=${info.postId.slice(0, 8)} seo=${info.seo} aeo=${info.aeo} geo=${info.geo}`);
      }
    }

    if (data.length < PAGE) break;
    offset += PAGE;
  }

  console.log(`\nDone. Stamped: ${stamped}, already-stamped/skipped: ${skipped}${DRY ? " (dry run — no writes)" : ""}`);
})();
