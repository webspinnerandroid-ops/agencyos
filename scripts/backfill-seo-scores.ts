/**
 * One-off backfill: compute a Rank Math-style on-page SEO score for every
 * existing blog post that doesn't have one yet (posts generated before the
 * scoring feature shipped). Mirrors the scoring in
 * src/app/api/generate-content/route.ts:
 *
 *   - keyword  = content.topic (the focus keyword the post was written around)
 *   - internal = the tenant's ready knowledge-base URLs (all workspaces —
 *                a backfill can't know which workspace each post belonged to;
 *                new generations score against their exact workspace)
 *   - writes content->'seo' and lets the sync_post_seo_columns trigger fill
 *     the seo_score / seo_checks columns
 *
 * Usage:
 *   npx tsx scripts/backfill-seo-scores.ts          # dry-run: show what WOULD change
 *   npx tsx scripts/backfill-seo-scores.ts --apply  # write the scores
 *   npx tsx scripts/backfill-seo-scores.ts --force  # re-score even scored posts (dry-run unless --apply)
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { scoreContent } from "../src/lib/rankmath";

// Minimal .env.local loader (dotenv is not a dependency here).
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const match = line.match(/^([A-Z0-9_]+)="?([^"\n]*)"?$/);
  if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
}

const APPLY = process.argv.includes("--apply");
const FORCE = process.argv.includes("--force");

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

interface PostRow {
  id: string;
  tenant_id: string;
  content: any;
}

async function loadInternalUrls(): Promise<Map<string, string[]>> {
  // tenant_id -> list of ready KB page URLs
  const map = new Map<string, string[]>();
  const { data: items } = await supabase
    .from("knowledgebase_items")
    .select("tenant_id, extracted_metadata")
    .eq("type", "url")
    .eq("status", "ready");
  for (const item of items ?? []) {
    const url = (item.extracted_metadata as any)?.url;
    if (typeof url !== "string" || !url) continue;
    const list = map.get(item.tenant_id) ?? [];
    list.push(url);
    map.set(item.tenant_id, list);
  }
  return map;
}

async function main() {
  const { data: posts, error } = await supabase
    .from("posts")
    .select("id, tenant_id, content")
    .eq("content->>type", "blog")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Failed to load posts:", error.message);
    process.exit(1);
  }

  const internalUrls = await loadInternalUrls();
  const toScore = (posts ?? []).filter((p: PostRow) => {
    if (FORCE) return true;
    return !p.content?.seo;
  });

  console.log(
    `${(posts ?? []).length} blog posts total, ${toScore.length} to score ` +
      `(${FORCE ? "--force" : "no existing seo payload"}${APPLY ? ", --apply" : ", dry-run"})`
  );

  const missingKeyword: string[] = [];
  const updates: { id: string; content: any; score: number }[] = [];

  for (const post of toScore as PostRow[]) {
    const c = post.content ?? {};
    const keyword = typeof c.topic === "string" ? c.topic.trim() : "";
    if (!keyword) {
      missingKeyword.push(post.id);
      continue;
    }
    const result = scoreContent({
      title: typeof c.title === "string" ? c.title : "",
      metaDescription: typeof c.metaDescription === "string" ? c.metaDescription : "",
      slug: typeof c.slug === "string" ? c.slug : "",
      body: typeof c.body === "string" ? c.body : "",
      keyword,
      internalUrls: internalUrls.get(post.tenant_id) ?? [],
    });
    updates.push({
      id: post.id,
      content: { ...c, seo: { score: result.total, grade: result.grade, keyword: result.keyword, wordCount: result.wordCount, checks: result.checks } },
      score: result.total,
    });
  }

  // Summary stats
  const avg = updates.length
    ? Math.round(updates.reduce((a, u) => a + u.score, 0) / updates.length)
    : 0;
  const buckets = { red: 0, yellow: 0, green: 0 };
  for (const u of updates) {
    const g = u.content.seo.grade as "red" | "yellow" | "green";
    buckets[g]++;
  }
  console.log(
    `Scored ${updates.length} posts — avg ${avg}/100 | red(<50): ${buckets.red}, yellow(51-80): ${buckets.yellow}, green(81+): ${buckets.green}`
  );
  console.log(`Skipped ${missingKeyword.length} posts without a content.topic keyword.`);

  // Show a few samples
  for (const u of updates.slice(0, 5)) {
    const failed = u.content.seo.checks.filter((x: any) => !x.passed).map((x: any) => x.id);
    console.log(
      `  ${u.score}/100 "${(u.content.title ?? "Untitled").slice(0, 50)}"` +
        (failed.length ? ` — fix: ${failed.join(", ")}` : " — all checks pass")
    );
  }
  if (updates.length > 5) console.log(`  … and ${updates.length - 5} more`);

  if (!APPLY) {
    console.log("\nDry run — nothing written. Re-run with --apply to store the scores.");
    return;
  }

  let ok = 0;
  for (const u of updates) {
    const { error: updErr } = await supabase
      .from("posts")
      .update({ content: u.content })
      .eq("id", u.id);
    if (updErr) {
      console.error(`  ✗ ${u.id}: ${updErr.message}`);
    } else {
      ok++;
    }
  }
  console.log(`\nWrote ${ok}/${updates.length} scores (seo_score/seo_checks synced by trigger).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
