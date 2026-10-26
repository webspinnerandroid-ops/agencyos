/** One-off diagnostic: find posts whose `title` looks like raw JSON or LLM junk. */
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

function loadEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
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

const env = loadEnv(path.join(__dirname, "..", ".env.local"));
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  // Pull only what the classifier needs — no content bodies.
  const { data: posts, error } = await sb
    .from("posts")
    .select("id, title, type, status, tenant_id, created_at, content->caption, content->title, workspace_id")
    .order("created_at", { ascending: false });
  if (error) {
    console.error("query failed:", error.message);
    process.exit(1);
  }

  const junk = [];
  for (const p of posts ?? []) {
    const t = (p.title ?? "").trim();
    if (!t) continue;
    const reasons = [];
    if (/^[\[{"]/.test(t)) reasons.push("starts-json");
    if (/^\s*(\{"|\[`|\[")/.test(t)) reasons.push("json-object");
    if (/```/.test(t)) reasons.push("code-fence");
    if (/"caption"\s*:/.test(t)) reasons.push("json-caption-key");
    if (/"type"\s*:\s*"(social|blog)"/i.test(t)) reasons.push("json-type-key");
    const upperFirst = /^(Here('| i)(s |'s) )/.test(t);
    if (upperFirst) reasons.push("llm-lede");
    if (t.length > 180) reasons.push("overlong");
    if (reasons.length) junk.push({ p, t, reasons });
  }

  console.log(`scanned ${posts.length} posts; ${junk.length} suspicious`);
  for (const { p, t, reasons } of junk.slice(0, 100)) {
    console.log("---- " + p.id, `title:${p.status}:` + p.type, "reasons:", reasons.join(","));
    console.log("   TITLE[" + t.length + "]:", JSON.stringify(t.slice(0, 170)));
    if (typeof p.caption === "string") console.log("   CAPTION-matches-title:", p.caption.slice(0, 120) === t.slice(0, 120));
  }
})();
