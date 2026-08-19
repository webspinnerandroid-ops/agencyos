import { NextRequest, NextResponse } from "next/server";
import { getTenantId, requireRole } from "@/lib/auth";

/**
 * POST /api/tasks/blog-generation
 *
 * Placeholder for Inngest-based async blog generation.
 * Currently returns a mock acceptance response. When Inngest is wired up,
 * this endpoint will enqueue a background job that:
 *  1. Generates a blog post via generateStructuredOutput (blog_generation)
 *  2. For each requested platform, generates a caption via generateText (social_caption)
 *  3. Saves all results to the posts table
 *  4. Optionally notifies the user via email / in-app notification
 *
 * For the MVP, the synchronous POST /api/generate-content route handles
 * all generation inline. Use this route once generation times exceed Vercel's
 * function timeout (10-60s depending on plan) or when you want to provide
 * progress updates during long-running generations.
 */
export async function POST(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    await requireRole("agency_editor");

    let body: {
      clientId?: string;
      topic: string;
      brandVoice?: string;
      platforms: string[];
    };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    // Basic validation
    if (!body.topic || !body.platforms || body.platforms.length === 0) {
      return NextResponse.json(
        { error: "topic and platforms are required" },
        { status: 400 }
      );
    }

    // No async blog-generation Inngest function exists yet; the synchronous
    // POST /api/generate-content route is the real implementation. Return an
    // honest 501 instead of a fake "task accepted" acknowledgement.
    return NextResponse.json(
      {
        error:
          "Async blog generation is not available yet — use POST /api/generate-content for synchronous generation.",
      },
      { status: 501 }
    );
  } catch (error) {
    console.error("[tasks/blog-generation] Error:", error);
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}