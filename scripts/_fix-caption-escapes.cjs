/** One-off: captions whose text still contains literal "\n" two-char
 * sequences render as visible "\n" between sentences. Convert them to real
 * newlines. Rerunnable: a converged run finds and changes nothing. */
const fs = require("fs");
const path = require("path");
const { createClient } = require(path.join(process.cwd(), "node_modules", "@supabase", "supabase-js"));

function loadEnv(file) {
  const out = {};
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

const env = loadEnv(path.join(process.cwd(), ".env.local"));
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  // fetch all captions client-side; the pattern match in SQL would need to
  // escape backslashes twice more (PostgREST LIKE), which is error-prone
  const { data, error } = await sb.from("posts").select("id,type,title,content");
  if (error) {
    console.error("Fetch failed:", error.message);
    process.exit(1);
  }
  const rows = data || [];
  let fixed = 0;
  for (const row of rows) {
    const content = typeof row.content === "object" && row.content ? row.content : null;
    if (!content || typeof content.caption !== "string") continue;
    if (!content.caption.includes("\\n")) continue;
    const before = content.caption;
    const after = before.replace(/\\n/g, "\n");
    content.caption = after;
    const { error: upErr } = await sb.from("posts").update({ content }).eq("id", row.id);
    if (upErr) {
      console.error("update failed", row.id.slice(0, 8), upErr.message);
      process.exitCode = 1;
      continue;
    }
    fixed++;
    const firstRealNewline = after.indexOf("\n");
    console.log("== fixed", row.id.slice(0, 8), row.type);
    console.log("  first segment:", JSON.stringify(after.slice(0, firstRealNewline > 0 ? firstRealNewline : 80)));
  }
  console.log(`captions normalized: ${fixed}`);
})();
