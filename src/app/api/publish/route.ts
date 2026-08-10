import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { publishToWordPress } from "@/lib/publishing/wordpressPublisher";
import { publishPost as publishToSocial } from "@/lib/publishing/socialPublisher";

export async function POST(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    const body = await request.json();
    const { postId, platform, action, scheduledAt } = body;

    if (!postId) {
      return NextResponse.json({ error: "postId required" }, { status: 400 });
    }

    const results: any[] = [];
    let allSucceeded = true;

    if (platform === "wordpress" || platform === "blog") {
      const wpResult = await publishToWordPress(postId, tenantId, action || "publish", scheduledAt);
      results.push(...wpResult.results);
      allSucceeded = wpResult.allSucceeded;
    } else if (["instagram", "twitter", "linkedin", "facebook", "tiktok", "threads"].includes(platform)) {
      const socialResult = await publishToSocial(postId, tenantId);
      results.push(...socialResult.results);
      allSucceeded = socialResult.allSucceeded;
    } else if (platform === "all") {
      // Publish to all connected platforms
      const [wpResult, socialResult] = await Promise.all([
        publishToWordPress(postId, tenantId, action || "publish", scheduledAt).catch(() => ({ allSucceeded: false, results: [] })),
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