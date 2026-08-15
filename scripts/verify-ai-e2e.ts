// scripts/verify-ai-e2e.ts
// End-to-end verification of the three flows that were reported broken on the
// VPS: Enhance Prompt, Generate Image, Generate Content. Runs the same lib
// code the API routes call, against the real tenant + production providers.
//
// Usage:
//   cd agency-os && set -a && . ./.env.local && set +a
//   TENANT_ID=0d564113-5b76-42c7-8e81-310ac469fd07 node scripts/verify-ai-e2e.cjs

import { createClient } from "@supabase/supabase-js";
import {
  generateImage,
  generateStructuredOutput,
} from "../src/lib/ai/orchestrator";
import { getBlogPrompt, getBlogPostSchema } from "../src/lib/ai/seo-prompts";
import {
  selectBlogImageSpecs,
  injectImagesIntoBody,
} from "../src/lib/blog-images";
import { persistImageToStorage } from "../src/lib/media/storage";
import { scoreContent } from "../src/lib/seo-scorer";
import { scoreAeoGeo } from "../src/lib/aeo-geo";

const TENANT_ID = process.env.TENANT_ID ?? "";

async function main() {
  const results: string[] = [];
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  // ---- 1. Enhance Prompt (the exact DeepSeek call the route makes) ----
  console.log("== [1/3] Enhance Prompt (DeepSeek deepseek-v4-flash) ==");
  try {
    const deepseekRes = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: "deepseek-v4-flash",
        messages: [
          {
            role: "system",
            content:
              "You are an expert AI image prompt engineer. Expand the brief concept into a detailed professional image prompt. Return ONLY the expanded prompt text — no quotes, no preamble, no markdown.",
          },
          { role: "user", content: "a cozy mountain cabin in autumn fog" },
        ],
        max_tokens: 500,
        temperature: 0.8,
        thinking: { type: "disabled" },
      }),
    });
    const dsData = (await deepseekRes.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const enhanced = (dsData?.choices?.[0]?.message?.content ?? "").trim();
    console.log(
      `  status: ${deepseekRes.status} | enhanced length: ${enhanced.length}`
    );
    console.log(`  preview: ${enhanced.slice(0, 120)}`);
    results.push(
      `enhance: HTTP ${deepseekRes.status}, ${enhanced.length} chars${
        enhanced ? "" : "  <-- EMPTY (BUG)"
      }`
    );
    if (!enhanced) process.exitCode = 1;
  } catch (err) {
    console.error("  enhance FAILED:", err);
    results.push(`enhance: ERROR ${(err as Error).message}`);
    process.exitCode = 1;
  }

  // ---- 2. Generate Image (Gemini -> Bunny CDN persist) ----
  console.log("== [2/3] Generate Image (Gemini -> persist to storage) ==");
  try {
    const imgRaw = await generateImage(
      TENANT_ID,
      "minimalist logo for a coffee roastery, warm earthy tones, studio light",
      { size: "1024x1024", n: 1 }
    );
    const rawUrl = imgRaw[0]?.url ?? "";
    console.log(
      `  provider url type: ${
        rawUrl.startsWith("data:") ? "base64 data-url" : rawUrl.slice(0, 70)
      }`
    );
    const cdnUrl = await persistImageToStorage(TENANT_ID, rawUrl);
    const isCdn = cdnUrl.startsWith("https://") && !cdnUrl.startsWith("data:");
    console.log(`  final url: ${cdnUrl.slice(0, 90)} | CDN: ${isCdn}`);
    results.push(`image: ${isCdn ? "CDN URL" : "NOT CDN"} ${cdnUrl.slice(0, 70)}`);
    if (!isCdn) process.exitCode = 1;
  } catch (err) {
    console.error("  image FAILED:", err);
    results.push(`image: ERROR ${(err as Error).message}`);
    process.exitCode = 1;
  }

  // ---- 3. Generate Content (blog structured output + imageCount=1) ----
  console.log("== [3/3] Generate Content (blog, imageCount=1) ==");
  try {
    const topic =
      "Why local coffee roasters should build an email list in 2026";
    const primaryKeyword = topic;
    const systemPrompt = getBlogPrompt("", { primaryKeyword });
    const userPrompt = `Write a comprehensive, publish-ready blog post about: "${topic}".`;

    const blogPost = (await generateStructuredOutput(
      "blog_generation" as never,
      systemPrompt,
      userPrompt,
      TENANT_ID,
      getBlogPostSchema(),
      { functionName: "generate_blog_post" }
    )) as {
      title?: string;
      slug?: string;
      metaDescription?: string;
      headings?: { level: number; text: string }[];
      body?: string;
      images?: { prompt: string; placement: string; sectionTitle?: string; description?: string }[];
    };

    const title = blogPost.title ?? "";
    const bodyRaw = typeof blogPost.body === "string" ? blogPost.body : "";
    const wordCount = bodyRaw.split(/\s+/).filter(Boolean).length;
    console.log(`  title: ${title}`);
    console.log(`  word count: ${wordCount}`);

    const specs = selectBlogImageSpecs(
      Array.isArray(blogPost.images) ? (blogPost.images as never) : [],
      1
    );
    console.log(
      `  image specs selected: ${specs.length} | placements: ${
        specs.map((s) => s.placement).join(",") || "(none)"
      }`
    );

    const generated: { spec: (typeof specs)[number]; url: string }[] = [];
    for (const spec of specs) {
      const size = spec.placement === "featured" ? "1792x1024" : "1024x1024";
      const imgs = await generateImage(TENANT_ID, spec.prompt, {
        size: size as "1792x1024" | "1024x1024",
        n: 1,
      });
      if (!imgs[0]?.url) {
        console.warn(
          `  no image from provider for ${spec.sectionTitle || "featured"}`
        );
        continue;
      }
      const url = await persistImageToStorage(TENANT_ID, imgs[0].url);
      generated.push({ spec, url });
      console.log(`  image persisted: ${url.slice(0, 70)}`);
    }

    const body = injectImagesIntoBody(bodyRaw, generated as never);
    const seo = scoreContent({
      title,
      metaDescription: blogPost.metaDescription ?? "",
      slug: blogPost.slug ?? "",
      body,
      keyword: primaryKeyword,
      internalUrls: [],
    });
    const aeoGeo = scoreAeoGeo({
      title,
      metaDescription: blogPost.metaDescription ?? "",
      body,
      keyword: primaryKeyword,
      entities: [],
    });

    const { data: postRow, error: postErr } = await sb
      .from("posts")
      .insert({
        tenant_id: TENANT_ID,
        client_id: null,
        content: {
          type: "blog",
          title,
          slug: blogPost.slug ?? "",
          metaDescription: blogPost.metaDescription ?? "",
          headings: Array.isArray(blogPost.headings) ? blogPost.headings : [],
          body,
          images: generated.map((g) => ({
            url: g.url,
            prompt: g.spec.prompt,
            placement: g.spec.placement,
            sectionTitle: g.spec.sectionTitle,
            description: g.spec.description,
          })),
          topic,
          brandVoice: "",
          seo: {
            score: seo.total,
            grade: seo.grade,
            keyword: seo.keyword,
            wordCount: seo.wordCount,
          },
          aeoGeo: { score: aeoGeo.total, grade: aeoGeo.grade },
        },
        status: "draft",
        created_by: null,
        ai_generated: true,
      })
      .select("id")
      .single();

    if (postErr || !postRow) {
      console.error("  INSERT FAILED:", postErr?.message ?? "no row");
      results.push(
        `content: FAILED to save (${postErr?.message ?? "no row"})`
      );
      process.exitCode = 1;
    } else {
      console.log("  saved post id:", postRow.id);
      results.push(
        `content: OK title="${title}" words=${wordCount} images=${generated.length} postId=${postRow.id}`
      );
    }
  } catch (err) {
    console.error("  content FAILED:", err);
    results.push(`content: ERROR ${(err as Error).message}`);
    process.exitCode = 1;
  }

  console.log("\n===== SUMMARY =====");
  for (const r of results) console.log("  ", r);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
