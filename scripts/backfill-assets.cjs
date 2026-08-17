// Backfill media_assets so the Asset Library shows everything correctly:
//   1. Set the `task` column from metadata->>'task' (migration 078 added the
//      column; old rows only carry the tag inside metadata JSON).
//   2. Re-upload assets whose stored extension doesn't match the actual bytes
//      (Recraft V3 vector output is SVG but was saved as .png → unrenderable
//      cards + corrupt downloads) to the right extension on Bunny, update the
//      row's url, and delete the old object.
//
// Safe to re-run: idempotent, only touches rows that are actually broken or
// missing the task tag. No secrets printed.
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

function sniffImageExt(buf) {
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

function mimeForExt(ext) {
  return (
    {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".webp": "image/webp",
      ".gif": "image/gif",
      ".svg": "image/svg+xml",
      ".avif": "image/avif",
    }[ext] || "application/octet-stream"
  );
}

const DRY = process.argv.includes("--dry");
const VERIFY = process.argv.includes("--verify");

(async () => {
  // Local .env.local first, then real process.env on top so the script runs
  // unchanged in CI (where secrets come from GitHub env, not a local file).
  const env = { ...loadEnv(path.join(__dirname, "..", ".env.local")), ...process.env };
  const { createClient } = require("@supabase/supabase-js");
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  const pullHost = (env.BUNNY_PULL_HOST || "agencyos.b-cdn.net")
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
  const storageBase = `https://${env.BUNNY_STORAGE_REGION || "la"}.storage.bunnycdn.com/${env.BUNNY_STORAGE_ZONE || "agencyos"}`;
  const cdnPrefix = `https://${pullHost}/`;

  let tagFixed = 0;
  let urlFixed = 0;
  let skipped = 0;
  let okCount = 0;
  let failed = 0;
  let offset = 0;
  const PAGE = 200;

  console.log(`Mode: ${VERIFY ? "VERIFY (read-only smoke test)" : DRY ? "DRY RUN (no writes)" : "LIVE"}`);
  console.log(`CDN: ${cdnPrefix}`);

  for (;;) {
    const { data, error } = await sb
      .from("media_assets")
      .select("id, url, task, metadata, tenant_id")
      .order("created_at", { ascending: false })
      .range(offset, offset + PAGE - 1);

    if (error) {
      console.error("Query error:", error.message);
      process.exit(1);
    }
    if (!data || data.length === 0) break;

    for (const row of data) {
      const metaTask = row.metadata && typeof row.metadata === "object" ? row.metadata.task : null;

      // --- 0. Verify mode: smoke-test every asset's bytes against its
      // stored extension. Nothing is written; a future migration or deploy
      // that silently corrupts asset formats shows up here as a MISMATCH.
      if (VERIFY) {
        const url = row.url || "";
        if (!url) { skipped++; continue; }
        let body = null;
        if (url.startsWith("data:")) {
          const m = url.match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/);
          if (!m) { skipped++; continue; }
          body = m[2] ? Buffer.from(m[3], "base64") : Buffer.from(decodeURIComponent(m[3]), "latin1");
        } else if (url.startsWith(cdnPrefix)) {
          try {
            const res = await fetch(url, { signal: AbortSignal.timeout(45000) });
            if (!res.ok) {
              console.log(`  [verify] ${row.id.slice(0, 8)} HTTP ${res.status} — ${url.slice(0, 90)}`);
              failed++;
              continue;
            }
            body = Buffer.from(await res.arrayBuffer());
          } catch (e) {
            console.log(`  [verify] ${row.id.slice(0, 8)} fetch error: ${e.message}`);
            failed++;
            continue;
          }
        } else {
          console.log(`  [verify] ${row.id.slice(0, 8)} non-CDN URL (${url.slice(0, 70)}…) — skipped`);
          skipped++;
          continue;
        }
        const sniffed = sniffImageExt(body);
        // Videos: MP4/MOV/WebM all start with an ftyp box — accept .mp4 for them.
        const isMp4 =
          body.length >= 12 &&
          body.subarray(4, 8).toString("latin1") === "ftyp";
        const pathPart = url.startsWith(cdnPrefix) ? url.slice(cdnPrefix.length) : null;
        const currentExt = pathPart ? path.extname(pathPart).toLowerCase() : "(data)";
        const ok =
          body.length > 0 &&
          ((sniffed !== null && currentExt === sniffed) ||
            (currentExt === ".mp4" && isMp4));
        if (ok) {
          okCount++;
        } else {
          failed++;
          console.log(
            `  [verify] MISMATCH ${row.id.slice(0, 8)} stored=${currentExt} sniffed=${sniffed ?? "?"} bytes=${body.length} — ${url.slice(0, 90)}`
          );
        }
        continue;
      }

      // --- 1. Task tag backfill ---
      if (!row.task && metaTask) {
        tagFixed++;
        if (!DRY) {
          await sb.from("media_assets").update({ task: metaTask }).eq("id", row.id);
        }
        console.log(`  [tag] ${row.id.slice(0, 8)} → task=${metaTask}`);
      }

      const url = row.url || "";
      if (!url) {
        skipped++;
        continue;
      }

      // --- 2. Extension fix ---
      let body = null;
      if (url.startsWith("data:")) {
        const m = url.match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/);
        if (!m) { skipped++; continue; }
        body = m[2] ? Buffer.from(m[3], "base64") : Buffer.from(decodeURIComponent(m[3]), "latin1");
      } else if (url.startsWith(cdnPrefix)) {
        try {
          const res = await fetch(url, { signal: AbortSignal.timeout(45000) });
          if (!res.ok) { skipped++; continue; }
          body = Buffer.from(await res.arrayBuffer());
        } catch {
          skipped++;
          continue;
        }
      } else {
        // Remote provider URL — probably expired; leave it for the user's
        // re-generation (nothing to backfill).
        skipped++;
        continue;
      }

      const sniffed = sniffImageExt(body);
      if (!sniffed) {
        // Bytes are unreadable (maybe an error body) — leave the row alone.
        skipped++;
        continue;
      }
      const pathPart = url.startsWith(cdnPrefix) ? url.slice(cdnPrefix.length) : null;
      const currentExt = pathPart ? path.extname(pathPart).toLowerCase() : null;
      if (currentExt === sniffed) {
        skipped++;
        continue; // already correct
      }

      urlFixed++;
      if (DRY) {
        console.log(`  [url] ${row.id.slice(0, 8)} ${currentExt || "?"} → ${sniffed} (${body.length} bytes)`);
        continue;
      }

      const tenant = row.tenant_id || "orphan";
      const newPath = `${tenant}/${crypto.randomUUID()}${sniffed}`;
      const up = await fetch(`${storageBase}/${newPath}`, {
        method: "PUT",
        headers: {
          AccessKey: env.BUNNY_STORAGE_API_KEY,
          "Content-Type": mimeForExt(sniffed),
        },
        body,
        signal: AbortSignal.timeout(90000),
      });
      if (!up.ok) {
        console.error(`  [url] upload FAILED (${up.status}) for ${row.id}`);
        continue;
      }
      const newUrl = `${cdnPrefix}${newPath}`;
      const upd = await sb.from("media_assets").update({ url: newUrl }).eq("id", row.id);
      if (upd.error) {
        console.error(`  [url] DB update FAILED for ${row.id}: ${upd.error.message}`);
        continue;
      }
      console.log(`  [url] ${row.id.slice(0, 8)} ${currentExt || "?"} → ${sniffed} (${body.length} bytes)`);
      // Delete the old object if it was on our CDN.
      if (pathPart) {
        await fetch(`${storageBase}/${pathPart}`, {
          method: "DELETE",
          headers: { AccessKey: env.BUNNY_STORAGE_API_KEY },
        }).catch(() => {});
      }
    }

    if (data.length < PAGE) break;
    offset += PAGE;
  }

  if (VERIFY) {
    console.log(`\nVerify done. OK: ${okCount}, FAILED: ${failed}, skipped: ${skipped}`);
    process.exit(failed > 0 ? 1 : 0);
  }
  console.log(`\nDone. task tags fixed: ${tagFixed}, urls fixed: ${urlFixed}, rows skipped/ok: ${skipped}`);
})();
