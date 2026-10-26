/**
 * One-off data repair: social posts whose `title` column received a raw LLM
 * caption dump (```json fence, multiline caption text, or the 80-char
 * LEFT() prefix stamped by the 021 denorm trigger), plus captions that
 * still contain a fenced JSON block. Reported first (dry run); apply with
 * --apply.
 *
 * The 021 trigger (BEFORE UPDATE OF content) resets posts.title to
 * COALESCE(content->>'title', LEFT(content->>'caption', 80), ...) on every
 * content write. Social rows have no content.title, so any content update
 * re-junks the title. Two consequences baked into this script:
 *   - every repaired social row ALSO gets content.title = derived label,
 *     so the trigger keeps the clean title on future content edits
 *   - the junk predicate must not flag our own derived first-line labels
 *
 * Junk predicate (type = 'social'):
 *   title contains a fence, contains a newline, or is a >=76-char prefix
 *   of the caption that is not the full caption.
 * Derived label: first caption line with >=12 letters, capped at 75 chars
 * on a word boundary, whitespace-collapsed to one line.
 *
 * Blog rows keep their human labels; only a fence leak would justify a fix.
 * No secrets printed. Idempotent: a converged second run finds nothing.
 */
const fs = require("fs");
const path = require("path");
let createClient;
try {
  ({ createClient } = require(path.join(process.cwd(), "node_modules", "@supabase", "supabase-js")));
} catch {
  ({ createClient } = require("@supabase/supabase-js"));
}

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

const APPLY = process.argv.includes("--apply");

/** Pull caption text out of a raw "```json {...}" title/caption dump. */
function deFence(raw) {
  if (!raw) return null;
  let s = String(raw);
  const fenced = s.includes("```");
  if (fenced) {
    const jsonMatch = s.match(/"caption"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (jsonMatch) {
      try {
        s = JSON.parse('"' + jsonMatch[1] + '"');
      } catch {
        s = jsonMatch[1].replace(/\\n/g, "\n").replace(/\\"/g, '"');
      }
    } else {
      s = s
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !/^```/.test(l))
        .join("\n");
    }
  }
  return s.replace(/^\s*```[a-z]*\s*$/gim, "").replace(/```/g, "").trim() || null;
}

/** Short human label from caption text: first meaty line, capped at 75 chars. */
const TITLE_CAP = 75;
function deriveTitleFromCaption(caption) {
  if (!caption) return null;
  const text = String(caption).replace(/\\n/g, "\n").trim();
  if (!text) return null;
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const meaty = lines.find((l) => l.replace(/[^A-Za-z0-9]/g, "").length >= 12);
  let candidate = (meaty || lines[0] || text).replace(/\s+/g, " ").trim();
  if (!candidate) return null;
  if (candidate.length > TITLE_CAP) {
    const cut = candidate.slice(0, TITLE_CAP);
    const sp = cut.lastIndexOf(" ");
    candidate = (sp > 40 ? cut.slice(0, sp) : cut).trim();
  }
  return candidate || null;
}

/**
 * Raw junk signature — deliberately does NOT include short caption-prefix
 * labels, because a derived first-line label itself is a (short) prefix.
 */
function isRawJunk(title, caption) {
  const t = title || "";
  if (t.includes("```") || /\n/.test(t)) return true;
  if (!caption) return false;
  const c = String(caption);
  return t !== c && t.length >= 76 && c.startsWith(t);
}

async function main() {
  const env = loadEnv(path.join(process.cwd(), ".env.local"));
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local");
    process.exit(1);
  }
  const sb = createClient(url, key);
  const { data, error } = await sb
    .from("posts")
    .select("id,title,type,content,status")
    .order("created_at", { ascending: true });
  if (error) {
    console.error("Fetch failed:", error.message);
    process.exit(1);
  }
  const rows = data || [];

  const changes = [];
  for (const row of rows) {
    const content = typeof row.content === "object" && row.content ? row.content : {};
    const rawCaption = content.caption != null ? String(content.caption) : null;
    const existingContentTitle = content.title != null ? String(content.title) : null;
    const title = row.title || "";

    // caption repair: only a lingering fence justifies touching content
    let newCaption = null;
    if (rawCaption && rawCaption.includes("```")) {
      const fixed = deFence(rawCaption);
      if (fixed && fixed !== rawCaption) newCaption = fixed;
    }

    const captionSource = newCaption || rawCaption;
    let newTitle = null;
    let seedContentTitle = null;

    if (row.type === "blog") {
      if (title.includes("```")) {
        newTitle = deriveTitleFromCaption(deFence(title) || title) || deFence(title);
      }
    } else if (isRawJunk(title, captionSource)) {
      newTitle = deriveTitleFromCaption(captionSource) || deFence(title) || title;
      if (!newTitle) continue;
      if (newTitle === title && !newCaption) continue;
      // seed content.title even when the column already carries the same
      // value, so the 021 trigger cannot re-junk it on the next content write
      seedContentTitle = newTitle;
      if (newTitle === title) newTitle = null;
    } else if (!existingContentTitle && rawCaption) {
      // already-cleaned row missing the seed: stamp content.title when our
      // derivation agrees with what the column actually shows
      const derived = deriveTitleFromCaption(rawCaption);
      if (derived && derived === title) seedContentTitle = derived;
    }

    if (!newTitle && !newCaption && !seedContentTitle) continue;
    changes.push({
      id: row.id,
      status: row.status,
      type: row.type,
      oldTitle: title,
      newTitle,
      seedContentTitle,
      newCaption,
    });
  }

  console.log(`rows scanned: ${rows.length}   rows needing repair: ${changes.length}`);
  console.log(
    `  title writes: ${changes.filter((c) => c.newTitle).length}` +
    `   content.title seeds: ${changes.filter((c) => c.seedContentTitle).length}` +
    `   caption de-fences: ${changes.filter((c) => c.newCaption).length}`
  );

  for (const c of changes.slice(0, 10)) {
    console.log("\n==", c.id.slice(0, 8), c.type, c.status);
    console.log("  title -", JSON.stringify(c.oldTitle.slice(0, 78)));
    console.log("  title +", c.newTitle ? JSON.stringify(String(c.newTitle).slice(0, 78)) : "(unchanged)");
    if (c.seedContentTitle) console.log("  seed content.title:", JSON.stringify(c.seedContentTitle.slice(0, 60)));
    if (c.newCaption) console.log("  caption + de-fenced (", c.newCaption.length, "chars )");
  }
  if (changes.length > 10) console.log(`\n... ${changes.length - 10} more listed only by count`);

  if (!APPLY) {
    console.log("\nDry run. Re-run with --apply to write the changes.");
    return;
  }

  let ok = 0;
  for (const c of changes) {
    const patch = {};
    if (c.newTitle) patch.title = c.newTitle;
    if (c.seedContentTitle || c.newCaption) {
      const { data: cur, error: fetchErr } = await sb
        .from("posts")
        .select("id,content")
        .eq("id", c.id)
        .single();
      if (fetchErr) {
        console.error("  fetch failed", c.id.slice(0, 8), fetchErr.message);
        continue;
      }
      const base = typeof cur.content === "object" && cur.content ? cur.content : {};
      patch.content = { ...base };
      if (c.seedContentTitle) patch.content.title = c.seedContentTitle;
      if (c.newCaption) patch.content.caption = c.newCaption;
    }
    const { error: upErr } = await sb.from("posts").update(patch).eq("id", c.id);
    if (upErr) {
      console.error("  update failed", c.id.slice(0, 8), upErr.message);
      continue;
    }
    ok++;
  }
  console.log(`\nApplied updates: ${ok}/${changes.length} rows`);
  if (ok !== changes.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
