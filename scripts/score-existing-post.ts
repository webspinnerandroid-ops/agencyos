/**
 * One-off maintenance script: score an already-generated blog post that was
 * written before team generation computed on-page SEO scores. Pure scoring
 * (seo-scorer module) — no LLM calls, no image generation.
 *
 * Usage: set env from .env.local, then:
 *   node -e "esbuild bundle" ... (see the run instruction in the shell command)
 */
import { createClient } from "@supabase/supabase-js";
import { scoreContent } from "../src/lib/seo-scorer";
import { getWorkspaceLinkablePages } from "../src/lib/knowledgebase";

async function main() {
  const tenantId = process.env.TENANT_ID!;
  const postId = process.env.POST_ID!;
  const workspaceId = process.env.WORKSPACE_ID || null;
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: post, error } = await sb
    .from("posts")
    .select("content, seo_score")
    .eq("id", postId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error || !post) throw new Error("post not found: " + error?.message);

  const content =
    typeof post.content === "string" ? JSON.parse(post.content) : post.content;
  const keyword = content.seo?.keyword || content.topic || content.title;

  let internalUrls: string[] = [];
  if (workspaceId) {
    try {
      internalUrls = (await getWorkspaceLinkablePages(workspaceId, tenantId)).map(
        (p) => p.url
      );
    } catch {
      internalUrls = [];
    }
  }

  const seo = scoreContent({
    title: content.title,
    metaDescription: content.metaDescription ?? "",
    slug: content.slug ?? "",
    body: content.body ?? "",
    keyword,
    internalUrls,
  });

  const nextContent = {
    ...content,
    seo: {
      score: seo.total,
      grade: seo.grade,
      keyword: seo.keyword,
      wordCount: seo.wordCount,
      checks: seo.checks,
    },
  };

  const { error: updErr } = await sb
    .from("posts")
    .update({ content: nextContent, seo_score: seo.total, seo_checks: seo.checks })
    .eq("id", postId)
    .eq("tenant_id", tenantId);
  if (updErr) throw new Error("update failed: " + updErr.message);

  console.log(
    JSON.stringify({
      postId,
      title: content.title,
      score: seo.total,
      grade: seo.grade,
      keyword: seo.keyword,
      wordCount: seo.wordCount,
      passed: seo.checks.filter((c) => c.passed).length + "/" + seo.checks.length,
    })
  );
}

main().catch((err) => {
  console.error("FAILED:", err.message);
  process.exit(1);
});
