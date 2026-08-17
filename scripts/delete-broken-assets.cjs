// Deletes media_assets rows that are fully broken: empty URL (never
// persisted) — the pre-workspace legacy video row 66d09db5. Also reports any
// other empty-URL rows it finds. Idempotent; prints what it deletes.
const fs = require("fs");
const path = require("path");

function loadEnv(file) {
  const out = {};
  // In CI there is no .env.local (it's gitignored) — env comes from
  // process.env. Never crash on a missing local file.
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

const DRY = process.argv.includes("--dry");
const TARGET = "66d09db5-07b1-484a-bd35-32c262cddc63";

(async () => {
  const env = { ...loadEnv(path.join(__dirname, "..", ".env.local")), ...process.env };
  const { createClient } = require("@supabase/supabase-js");
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  // Find all empty-URL rows (fully broken — nothing to display or download).
  const { data, error } = await sb
    .from("media_assets")
    .select("id, type, url, metadata, created_at")
    .or(`url.is.null,url.eq.`);
  if (error) {
    console.error("Query error:", error.message);
    process.exit(1);
  }
  const rows = data ?? [];
  console.log(`Empty-URL asset rows found: ${rows.length}`);
  for (const r of rows) {
    console.log(`  ${r.id}  type=${r.type}  created=${r.created_at}`);
  }

  const toDelete = rows.filter((r) => r.id === TARGET || r.id === TARGET.toLowerCase());
  if (toDelete.length === 0) {
    console.log(`Target ${TARGET} not found among empty-URL rows — nothing to delete.`);
    return;
  }
  for (const r of toDelete) {
    if (DRY) {
      console.log(`  [dry] would delete ${r.id}`);
      continue;
    }
    const { error: delErr } = await sb.from("media_assets").delete().eq("id", r.id);
    if (delErr) console.error(`  [delete] FAILED ${r.id}: ${delErr.message}`);
    else console.log(`  [delete] deleted ${r.id}`);
  }
  console.log(DRY ? "Dry run — no writes." : "Done.");
})();
