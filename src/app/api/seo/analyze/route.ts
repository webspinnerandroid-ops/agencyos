import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { analyzeContent } from "@/lib/seo/analyzer";
import { parseJsonBody } from "@/lib/api-validate";
import { seoAnalyzeSchema } from "@/lib/validations";

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

    const body = await parseJsonBody(request, seoAnalyzeSchema);
    if (!body.ok) return body.response;

    const result = await analyzeContent(body.data);
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
