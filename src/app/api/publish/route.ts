import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { publishToWordPress } from "@/lib/publishing/wordpressPublisher";
import { publishPost as publishToSocial } from "@/lib/publishing/socialPublisher";
import { scoreAeoGeo } from "@/lib/aeo-geo";

/**
 * Score-based publish gate: content below this score is blocked from being
 * scheduled/published, so low-quality drafts can't go live. The gate checks
 * BOTH the Rank Math-style SEO score AND the AEO/GEO readiness score — a blog
 * must clear both bars (the combined score is the lower of the two). Blogs
 * below the bar are auto-rewritten through Cheryl's pipeline (max 2 times),
 * then the user retries. Admins can override with force=true (they own the
 * final call). Configurable via the SEO_SCORE_PUBLISH_MIN env var (default 80).
 */
function getPublishMinScore(): number {
  const raw = Number(process.env.SEO_SCORE_PUBLISH_MIN);
  return Number.isFinite(raw) && raw >= 0 && raw <= 100 ? raw : 80;
}

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

      const minScore = getPublishMinScore();
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

    if (platform === "wordpress" || platform === "blog") {
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