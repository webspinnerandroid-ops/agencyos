/**
 * One-off backfill: repair a post whose body kept literal IMAGE_URL_N
 * placeholders because the structured image specs were lost (truncated JSON
 * that the repair salvaged body-first). Mirrors the fixed logic in
 * src/app/api/generate-content/route.ts:
 *   1. extract placeholders from the body
 *   2. build specs: featured (from title+topic) + inline (from alt texts)
 *   3. generate + save to media_assets
 *   4. inject into the body (stripping any leftover placeholders)
 *
 * Usage: npx tsx scripts/backfill-post-images.ts <postId>
 */
import { createClient } from "@supabase/supabase-js";
import { generateImage } from "../src/lib/ai/orchestrator";
import {
  selectBlogImageSpecs,
  injectImagesIntoBody,
  extractImagePlaceholders,
  type BlogImageSpec,
  type GeneratedBlogImage,
} from "../src/lib/blog-images";
// Minimal .env.local loader (dotenv is not a dependency here).
import { readFileSync } from "fs";
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const match = line.match(/^([A-Z0-9_]+)="?([^"\n]*)"?$/);
  if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
}

const postId = process.argv[2];
if (!postId) {
  console.error("Usage: npx tsx scripts/backfill-post-images.ts <postId>");
  process.exit(1);
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function main() {
  const { data: post, error: postErr } = await supabase
    .from("posts")
    .select("id, tenant_id, client_id, workspace_id, content")
    .eq("id", postId)
    .single();
  if (postErr || !post) {
    console.error("Post lookup failed:", postErr?.message);
    process.exit(1);
  }

  const content = post.content as any;
  const body: string = content.body ?? "";
  const topic: string = content.topic ?? content.title ?? "this topic";
  const title: string = content.title ?? "Untitled";

  const placeholders = extractImagePlaceholders(body);
  if (placeholders.length === 0 && !body.includes("IMAGE_URL")) {
    console.log("No placeholders found — nothing to repair.");
    return;
  }

  // Same derivation as the fixed route.
  let specs: BlogImageSpec[] = [
    {
      prompt: `Featured image for a blog post titled "${title}" about: ${topic}. High quality, editorial, on-brand.`,
      placement: "featured",
      sectionTitle: "",
      description: `Featured image for ${title}`,
    },
    ...placeholders.map((ph) => ({
      prompt: `Blog illustration for a post about "${topic}". ${ph.alt}. Detailed, on-brand, editorial quality.`,
      placement: "inline" as const,
      sectionTitle: "",
      description: ph.alt || `Inline image ${ph.index}`,
    })),
  ];
  specs = selectBlogImageSpecs(specs);
  console.log(`Generating ${specs.length} image(s) for post ${postId}...`);

  const generated: GeneratedBlogImage[] = [];
  for (const spec of specs) {
    try {
      const size =
        spec.placement === "featured" ? "1792x1024" : "1024x1024";
      const images = await generateImage(post.tenant_id, spec.prompt, {
        size: size as "1792x1024" | "1024x1024",
        n: 1,
        clientId: post.client_id ?? undefined,
      });
      const url = images[0]?.url;
      if (!url) {
        console.warn(`No image returned for "${spec.description}"`);
        continue;
      }
      const { error: assetErr } = await supabase.from("media_assets").insert({
        tenant_id: post.tenant_id,
        client_id: post.client_id ?? null,
        workspace_id: post.workspace_id,
        type: "image",
        prompt: spec.prompt,
        url,
        metadata: { placement: spec.placement, sectionTitle: spec.sectionTitle },
        status: "completed",
      });
      if (assetErr) console.warn("media_assets insert:", assetErr.message);
      generated.push({ spec, url });
      console.log(`  ✓ ${spec.placement} — ${url.slice(0, 60)}...`);
    } catch (err) {
      console.warn(
        `Image generation failed for "${spec.description}":`,
        err instanceof Error ? err.message : err
      );
    }
  }

  const newBody = injectImagesIntoBody(body, generated);
  const updatedContent = {
    ...content,
    body: newBody,
    images: generated.map((img) => ({
      url: img.url,
      prompt: img.spec.prompt,
      placement: img.spec.placement,
      sectionTitle: img.spec.sectionTitle,
      description: img.spec.description,
    })),
  };

  const { error: updErr } = await supabase
    .from("posts")
    .update({ content: updatedContent })
    .eq("id", postId);
  if (updErr) {
    console.error("Post update failed:", updErr.message);
    process.exit(1);
  }

  console.log(
    `Done. ${generated.length} image(s) injected; leftover placeholders: ${
      newBody.match(/IMAGE_URL_\d+/g)?.length ?? 0
    }`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
