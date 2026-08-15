import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { analyzeContent } from "@/lib/seo/analyzer";

/**
 * POST /api/seo/analyze
 * Runs the same SEO + AEO/GEO scoring engines used by audits on a URL or a
 * pasted piece of text, and returns the full per-check results so the UI can
 * show exactly how the score was made (and whether it clears the 80/80 gate).
 *
 * Body:
 *   { url?: string, text?: string, title?: string, keyword?: string }
 * Exactly one of url/text is required.
 */
export async function POST(request: NextRequest) {
  try {
    await getTenantId();

    let body: {
      url?: string;
      text?: string;
      title?: string;
      keyword?: string;
    };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body." },
        { status: 400 }
      );
    }

    const hasUrl = typeof body.url === "string" && body.url.trim().length > 0;
    const hasText = typeof body.text === "string" && body.text.trim().length > 0;
    if (!hasUrl && !hasText) {
      return NextResponse.json(
        { error: "Provide a URL or a piece of text content to analyze." },
        { status: 400 }
      );
    }
    if (hasUrl && hasText) {
      return NextResponse.json(
        { error: "Provide either a URL or text, not both." },
        { status: 400 }
      );
    }

    const result = await analyzeContent(body);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Analysis failed";
    if (message.includes("Provide a URL")) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    console.error("[seo/analyze]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
