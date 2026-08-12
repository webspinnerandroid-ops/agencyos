import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { publishToWordPress } from "@/lib/publishing/wordpressPublisher";
import { publishPost as publishToSocial } from "@/lib/publishing/socialPublisher";

/**
 * Score-based publish gate: content below this SEO score is blocked from
 * being scheduled/published, so low-quality drafts can't go live. Admins can
 * override with force=true (they own the final call). Configurable via the
 * SEO_SCORE_PUBLISH_MIN env var (default 50).
 */
function getPublishMinScore(): number {
  const raw = Number(process.env.SEO_SCORE_PUBLISH_MIN);
  return Number.isFinite(raw) && raw >= 0 && raw <= 100 ? raw : 50;
}

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
        .select("seo_score, status, content")
        .eq("id", postId)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (!post) {
        return NextResponse.json({ error: "Post not found" }, { status: 404 });
      }

      const minScore = getPublishMinScore();
      const isBlog =
        (typeof post.content === "string"
          ? (() => {
              try {
                return JSON.parse(post.content);
              } catch {
                return null;
              }
            })()
          : post.content)?.type === "blog";

      // Blogs must clear the score bar; social posts don't carry a score yet.
      if (isBlog && (post.seo_score ?? 0) < minScore) {
        return NextResponse.json(
          {
            error: `This post's SEO score (${post.seo_score ?? 0}/100) is below the publish minimum (${minScore}). Improve the content or regenerate it, then try again.`,
            code: "score_gate",
            score: post.seo_score ?? 0,
            minScore,
          },
          { status: 403 }
        );
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