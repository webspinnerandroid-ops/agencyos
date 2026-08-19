import { NextRequest, NextResponse } from "next/server";
import { getTenantId, getRole } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { publishToWordPress } from "@/lib/publishing/wordpressPublisher";
import { publishPost as publishToSocial } from "@/lib/publishing/socialPublisher";
import { scoreAeoGeo } from "@/lib/aeo-geo";
import { getScoreGate } from "@/lib/score-gate";
import { newBlockId, slugify } from "@/lib/cms";

/**
 * Converts a generated blog post's body (markdown with inline ![alt](url)
 * images) into CMS blocks: text blocks for prose, image blocks for the
 * embedded images. Returns a list of blocks ready for a site_pages row.
 */
function blogBodyToBlocks(body: string): any[] {
  const blocks: any[] = [];
  const imageRe = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let imgCount = 0;
  while ((m = imageRe.exec(body))) {
    const before = body.slice(last, m.index).trim();
    if (before) blocks.push({ id: newBlockId(), kind: "text", content: before });
    imgCount += 1;
    // First image is the featured hero (full-width, centered); the rest float
    // left/right alternating so text wraps around them instead of stacking.
    const float =
      imgCount === 1 ? "none" : imgCount % 2 === 0 ? "left" : "right";
    blocks.push({
      id: newBlockId(),
      kind: "image",
      url: m[2],
      alt: m[1] || "",
      style: { float },
    });
    last = m.index + m[0].length;
  }
  const after = body.slice(last).trim();
  if (after) blocks.push({ id: newBlockId(), kind: "text", content: after });
  if (blocks.length === 0) blocks.push({ id: newBlockId(), kind: "text", content: body });
  return blocks;
}

// Score-based publish gate: content below this score is blocked from being
// scheduled/published, so low-quality drafts can't go live. The gate checks
// BOTH the on-page SEO score AND the AEO/GEO readiness score — a blog
// must clear both bars (the combined score is the lower of the two). Blogs
// below the bar are auto-rewritten through Cheryl's pipeline (max 2 times),
// then the user retries. Admins can override with force=true (they own the
// final call). Same knob (SEO_SCORE_PUBLISH_MIN, default 80) as the
// generation-time gate in src/lib/score-gate.ts — one setting for the whole
// pipeline, and generation already refuses to save sub-gate drafts.

const MAX_AUTO_REWRITES = 2;

export async function POST(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    const body = await request.json();
    const { postId, platform, action, scheduledAt, categoryId, force } = body;

    if (!postId) {
      return NextResponse.json({ error: "postId required" }, { status: 400 });
    }

    // ---- Score gate (publish/schedule only; drafts are always fine) ----
    const publishing = action === "publish" || action === "schedule";
    if (publishing && !force) {
      const supabase = await createServiceClient();
      const { data: post } = await supabase
        .from("posts")
        .select("seo_score, aeo_geo_score, auto_rewrite_count, status, content, title")
        .eq("id", postId)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (!post) {
        return NextResponse.json({ error: "Post not found" }, { status: 404 });
      }

      const minScore = getScoreGate();
      const parsedContent =
        typeof post.content === "string"
          ? (() => {
              try {
                return JSON.parse(post.content);
              } catch {
                return null;
              }
            })()
          : post.content;
      const isBlog = parsedContent?.type === "blog";

      if (isBlog) {
        // Combined gate: the LOWER of SEO and AEO/GEO readiness. A blog must
        // clear both bars to publish.
        let aeoGeoScore: number | null = post.aeo_geo_score;
        if (aeoGeoScore == null) {
          // No stored AEO/GEO score — compute the free heuristic on the fly.
          const bodyMd =
            typeof parsedContent?.body === "string" ? parsedContent.body : "";
          const result = scoreAeoGeo({
            title: post.title ?? "",
            metaDescription: parsedContent?.metaDescription ?? "",
            body: bodyMd,
            keyword:
              parsedContent?.focusKeyword ??
              parsedContent?.keyword ??
              parsedContent?.topic ??
              "",
          });
          aeoGeoScore = result.total;
          // Persist it so the gate doesn't recompute every attempt.
          await supabase
            .from("posts")
            .update({ aeo_geo_score: result.total })
            .eq("id", postId)
            .eq("tenant_id", tenantId);
        }
        const seoScore = post.seo_score ?? 0;
        const combined = Math.min(seoScore, aeoGeoScore ?? 0);

        if (combined < minScore) {
          const rewriteCount = Number(post.auto_rewrite_count ?? 0);
          const canRewrite = rewriteCount < MAX_AUTO_REWRITES;
          if (canRewrite) {
            // Auto-rewrite through Cheryl's pipeline (background). Increment
            // the guard FIRST so a concurrent retry can't double-fire.
            await supabase
              .from("posts")
              .update({ auto_rewrite_count: rewriteCount + 1 })
              .eq("id", postId)
              .eq("tenant_id", tenantId);
            const { inngest } = await import("@/lib/inngest/client");
            await inngest.send({
              name: "content/auto-rewrite",
              data: { postId, tenantId },
            });
            return NextResponse.json(
              {
                error: `This post's combined score (SEO ${seoScore} / AEO-GEO ${aeoGeoScore}, gate ${minScore}) is below the publish minimum. Auto-rewriting it now — try publishing again in about a minute.`,
                code: "score_gate",
                score: combined,
                minScore,
                autoRewriting: true,
              },
              { status: 403 }
            );
          }
          return NextResponse.json(
            {
              error: `This post's combined score (SEO ${seoScore} / AEO-GEO ${aeoGeoScore}, gate ${minScore}) is below the publish minimum after ${rewriteCount} auto-rewrite${rewriteCount === 1 ? "" : "s"}. Improve the content or regenerate it manually, or force-publish.`,
              code: "score_gate",
              score: combined,
              minScore,
              autoRewriting: false,
            },
            { status: 403 }
          );
        }
      }
    }

    const results: any[] = [];
    let allSucceeded = true;

    if (platform === "cms") {
      // Publish to the tenant's OWN website (the CMS site built in this
      // system) as a published blog_post page. The post must be a blog;
      // social posts don't map to a CMS page.
      const supabase = await createServiceClient();
      const { data: post } = await supabase
        .from("posts")
        .select("content, title, workspace_id, client_id")
        .eq("id", postId)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (!post) {
        return NextResponse.json({ error: "Post not found" }, { status: 404 });
      }
      const content =
        typeof post.content === "string"
          ? (() => {
              try {
                return JSON.parse(post.content);
              } catch {
                return null;
              }
            })()
          : post.content;
      const title = content?.title || post.title || "Untitled Post";
      const body = typeof content?.body === "string" ? content.body : "";
      if (!body.trim()) {
        return NextResponse.json(
          { error: "This post has no body content to publish to the website." },
          { status: 400 }
        );
      }
      const slug = slugify(content?.slug || title);
      // Upsert by (tenant, slug): re-publishing updates the existing page.
      const { data: existing } = await supabase
        .from("site_pages")
        .select("id, blocks")
        .eq("tenant_id", tenantId)
        .eq("slug", slug)
        .maybeSingle();
      const blocks = blogBodyToBlocks(body);
      const patch = {
        tenant_id: tenantId,
        workspace_id: post.workspace_id ?? null,
        client_id: post.client_id ?? null,
        title,
        slug,
        blocks,
        kind: "blog_post",
        is_published: true,
        preview_token: crypto.randomUUID(),
        published_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      if (existing) {
        await supabase
          .from("site_pages")
          .update(patch)
          .eq("id", existing.id)
          .eq("tenant_id", tenantId);
      } else {
        await supabase.from("site_pages").insert(patch);
      }
      // Track the publish on the post itself so content lists can show an
      // "On site" badge linking to the live page.
      await supabase
        .from("posts")
        .update({
          cms_published_at: new Date().toISOString(),
          cms_slug: slug,
        })
        .eq("id", postId)
        .eq("tenant_id", tenantId);
      results.push({ platform: "cms", success: true, url: `/site/${slug}` });

      // IndexNow: tell search engines the page just went live (platform host
      // + any custom domains mapped to this tenant). Best-effort, never blocks.
      const { pingPagePublish } = await import("@/lib/indexnow");
      void pingPagePublish(tenantId, slug).then((res) => {
        const failed = res.filter((r) => !r.ok);
        if (failed.length > 0) {
          console.error(
            "[publish] IndexNow ping failed:",
            failed.map((f) => f.detail).join("; ")
          );
        }
      });
    } else if (platform === "site_blog") {
      // Publish to the marketing site's blog (/blog/<slug>) — the super
      // admin's own site. Super admin only; the generated post's body,
      // title, excerpt, and featured image are mirrored into the global
      // site_blog_posts table.
      const role = await getRole();
      if (role !== "super_admin") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      const supabase = await createServiceClient();
      const { data: post } = await supabase
        .from("posts")
        .select("content, title, media_urls, seo_score, aeo_geo_score")
        .eq("id", postId)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (!post) {
        return NextResponse.json({ error: "Post not found" }, { status: 404 });
      }
      const content =
        typeof post.content === "string"
          ? (() => {
              try {
                return JSON.parse(post.content);
              } catch {
                return null;
              }
            })()
          : post.content;
      const title = content?.title || post.title || "Untitled Post";
      const body = typeof content?.body === "string" ? content.body : "";
      if (!body.trim()) {
        return NextResponse.json(
          { error: "This post has no body content to publish to the site blog." },
          { status: 400 }
        );
      }
      const { sanitizePostSlug, slugifyTitle, deriveExcerpt, firstImageUrl } =
        await import("@/lib/site-blog");
      const slug =
        sanitizePostSlug(content?.slug) ||
        slugifyTitle(content?.slug || title);
      const featuredImage =
        (Array.isArray(post.media_urls) && post.media_urls[0]) ||
        firstImageUrl(body);
      const excerpt =
        (typeof content?.metaDescription === "string" && content.metaDescription.trim()) ||
        deriveExcerpt(body, title);
      const now = new Date().toISOString();
      // "draft" mirrors the post into the site blog as a draft (super admin
      // reviews in /dashboard/admin/blog before going live); publish/schedule
      // go straight to published. Defaults to published for back-compat.
      const asDraft = action === "draft";
      const { data: existing } = await supabase
        .from("site_blog_posts")
        .select("id")
        .eq("slug", slug)
        .maybeSingle();
      const patch = {
        title,
        body,
        excerpt: excerpt.slice(0, 300),
        featured_image_url: featuredImage || null,
        status: (asDraft ? "draft" : "published") as "draft" | "published",
        published_at: asDraft ? null : now,
        updated_at: now,
        // Carry the quality scores from the source post so /blog cards and
        // the admin list show them (null when the source was unscored).
        seo_score: typeof post.seo_score === "number" ? post.seo_score : null,
        aeo_geo_score:
          typeof post.aeo_geo_score === "number" ? post.aeo_geo_score : null,
      };
      if (existing) {
        await supabase
          .from("site_blog_posts")
          .update(patch)
          .eq("id", existing.id);
      } else {
        await supabase
          .from("site_blog_posts")
          .insert({ ...patch, slug });
      }
      results.push({
        platform: "site_blog",
        success: true,
        url: `/blog/${slug}`,
      });
    } else if (platform === "wordpress" || platform === "blog") {
      const wpResult = await publishToWordPress(postId, tenantId, action || "publish", scheduledAt, categoryId);
      results.push(...wpResult.results);
      allSucceeded = wpResult.allSucceeded;
    } else if (["instagram", "twitter", "linkedin", "facebook", "tiktok", "threads"].includes(platform)) {
      const socialResult = await publishToSocial(postId, tenantId);
      results.push(...socialResult.results);
      allSucceeded = socialResult.allSucceeded;
    } else if (platform === "all") {
      // Publish to all connected platforms
      const [wpResult, socialResult] = await Promise.all([
        publishToWordPress(postId, tenantId, action || "publish", scheduledAt, categoryId).catch(() => ({ allSucceeded: false, results: [] })),
        // Social publishers don't support scheduling yet — skip them for
        // schedule actions so we don't publish immediately by accident.
        action === "schedule"
          ? Promise.resolve({ allSucceeded: true, results: [] })
          : publishToSocial(postId, tenantId).catch(() => ({ allSucceeded: false, results: [] })),
      ]);
      results.push(...wpResult.results, ...socialResult.results);
      allSucceeded = wpResult.allSucceeded && socialResult.allSucceeded;
    } else {
      return NextResponse.json({ error: `Unknown platform: ${platform}` }, { status: 400 });
    }

    return NextResponse.json({
      success: allSucceeded,
      results,
      message: allSucceeded ? "Published successfully" : "Some platforms failed",
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Publish failed" }, { status: 500 });
  }
}