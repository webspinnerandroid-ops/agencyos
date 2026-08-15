// scripts/test-wp-publish.ts
// One-off end-to-end test of the WordPress publisher's SEO-meta handling:
//   1. Inserts a draft blog post with a full SEO-meta payload (Article +
//      FAQPage + social) into the DB.
//   2. Calls the REAL publishToWordPress path against the connected test site.
//   3. Reads the created WP post back and verifies the embedded JSON-LD
//      script landed in its content.
//   4. Deletes the DB test post + the WP test post.
//
// Usage: cd agency-os && set -a && . ./.env.local && set +a
//   node scripts/test-wp-publish.cjs <blog_platform_id>

import { createClient } from "@supabase/supabase-js";
import { publishToWordPress } from "../src/lib/publishing/wordpressPublisher";
import { buildWpSeoMeta } from "../src/lib/seo/wp-seo-meta";
import { decrypt } from "../src/lib/encryption";

const platformId = process.argv[2];
if (!platformId) {
  console.error("usage: node scripts/test-wp-publish.cjs <blog_platform_id>");
  process.exit(1);
}

async function main() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  const { data: platform } = await sb
    .from("blog_platforms")
    .select("*")
    .eq("id", platformId)
    .maybeSingle();
  if (!platform) throw new Error("platform not found");
  const tenantId = platform.tenant_id as string;

  const seoMeta = buildWpSeoMeta({
    title: "Seasonal Coffee Menus Build Loyalty — E2E Test",
    metaDescription: "Seasonal coffee menus keep customers coming back. Here's why, plus a launch plan.",
    focusKeyword: "seasonal coffee menu",
    qaPairs: [
      { q: "What is a seasonal coffee menu?", a: "A rotating menu of limited-time drinks tied to the season." },
      { q: "How do seasonal menus build loyalty?", a: "Scarcity and anticipation create repeat visits." },
    ],
    slug: "seasonal-coffee-menus-loyalty-e2e",
    siteName: "Bliss Media Lab (test client)",
    body: "1. Pick three seasonal flavors.\n2. Price them as limited-time offers.\n3. Market them on social.",
    schemaTypes: ["Article", "FAQPage", "HowTo"],
  });

  // 1. Insert the draft post.
  const { data: post, error: postErr } = await sb
    .from("posts")
    .insert({
      tenant_id: tenantId,
      content: {
        type: "blog",
        title: "Seasonal Coffee Menus Build Loyalty — E2E Test",
        slug: "seasonal-coffee-menus-loyalty-e2e",
        metaDescription: seoMeta.meta.seo_description,
        headings: [{ level: 1, text: "Seasonal Coffee Menus" }],
        body: "## Seasonal Coffee Menus\n\nSeasonal coffee menus refer to limited-time drinks tied to the season.\n\n1. Pick three seasonal flavors.\n2. Price them as limited-time offers.\n3. Market them on social.\n\n## FAQ\n\n**What is a seasonal coffee menu?**\nA rotating menu of limited-time drinks tied to the season.\n\n**How do seasonal menus build loyalty?**\nScarcity and anticipation create repeat visits.\n",
        images: [],
        seoMeta: seoMeta.meta,
      },
      status: "draft",
      ai_generated: false,
    })
    .select("id")
    .single();
  if (postErr) throw new Error("insert post failed: " + postErr.message);
  const postId = post.id;
  console.log("DB post inserted:", postId);

  // 2. Real publisher path.
  const result = await publishToWordPress(postId, tenantId, "publish");
  console.log("publish results:", JSON.stringify(result.results));

  if (!result.allSucceeded || !result.results[0]?.wpPostId) {
    throw new Error("publish failed: " + JSON.stringify(result.results));
  }
  const wpId = result.results[0].wpPostId;

  // 3. Read the WP post back and verify embedded schema.
  const creds = JSON.parse(decrypt(platform.encrypted_credentials));
  const auth = "Basic " + Buffer.from(`${creds.username}:${creds.applicationPassword}`).toString("base64");
  const base = (platform.site_url as string).replace(/\/$/, "");
  const back = await fetch(`${base}/wp-json/wp/v2/posts/${wpId}?context=edit`, {
    headers: { Authorization: auth },
  });
  const bd = await back.json();
  const contentRaw = bd.content?.raw ?? "";
  console.log("--- verification ---");
  console.log("wp post id:", wpId, "status:", back.status);
  console.log("content has ld+json:", contentRaw.includes("application/ld+json"));
  console.log("content has Article schema:", contentRaw.includes('"Article"'));
  console.log("content has FAQPage schema:", contentRaw.includes('"FAQPage"'));
  console.log("content has HowTo schema:", contentRaw.includes('"HowTo"'));
  console.log("content has client name:", contentRaw.includes("Bliss Media Lab"));
  console.log("wp post url:", bd.link);

  // 4. Cleanup.
  await fetch(`${base}/wp-json/wp/v2/posts/${wpId}`, { method: "DELETE", headers: { Authorization: auth } });
  await sb.from("posts").delete().eq("id", postId);
  console.log("cleanup done");
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
