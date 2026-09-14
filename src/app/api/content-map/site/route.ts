import { NextRequest, NextResponse } from "next/server";
import { getTenantId, requireRole } from "@/lib/auth";
import { getCurrentWorkspaceId } from "@/lib/workspace";
import { rateLimitRequest } from "@/lib/rate-limit";
import { addUrlItem, getWorkspaceLinkablePages } from "@/lib/knowledgebase";

/**
 * POST /api/content-map/site  { url }
 *
 * Upload the client's EXISTING website so its pages become internal-link
 * targets for generated content. The URL is added to the workspace knowledge
 * base as a URL item, which fire-and-forget crawls the same-domain pages
 * (existing addUrlItem machinery) — each crawled page automatically becomes a
 * linkable page that generation resolves [INTERNAL LINK] markers against and
 * the SEO scorer counts as "internal".
 *
 * Optional by design: no site uploaded is a normal state — generation still
 * works, the model just picks its own internal-link targets from CMS pages.
 *
 * GET /api/content-map/site
 *   Returns the linkable pages indexed so far, so the Content Map card can
 *   show crawl progress ("N pages linkable").
 */
export async function GET() {
  try {
    const tenantId = await getTenantId();
    await requireRole("agency_editor");
    const workspaceId = await getCurrentWorkspaceId();

    if (!workspaceId) {
      return NextResponse.json({ pages: [] });
    }

    const pages = await getWorkspaceLinkablePages(workspaceId, tenantId);
    return NextResponse.json({
      pages: pages.map((p) => ({ title: p.title, url: p.url })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const rl = rateLimitRequest(request, "content-map-site", 5);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: `Rate limit exceeded. Try again in ${rl.retryAfterSeconds}s.` },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
      );
    }

    const tenantId = await getTenantId();
    await requireRole("agency_editor");
    const workspaceId = await getCurrentWorkspaceId();

    const body = (await request.json().catch(() => ({}))) as { url?: string };
    const rawUrl = body.url?.trim();
    if (!rawUrl) {
      return NextResponse.json({ error: "Provide the site's URL." }, { status: 400 });
    }

    let normalized: string;
    try {
      normalized = new URL(/^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`).href.replace(/\/$/, "");
      if (!normalized.includes(".")) throw new Error("no host");
    } catch {
      return NextResponse.json(
        { error: `"${rawUrl}" is not a valid URL (e.g. https://example.com).` },
        { status: 400 }
      );
    }

    const result = await addUrlItem(
      `Client website — ${new URL(normalized).hostname}`,
      normalized,
      null,
      workspaceId ?? undefined
    );
    if (!result.success) {
      return NextResponse.json(
        { error: result.error ?? "Failed to start the site crawl" },
        { status: 500 }
      );
    }

    // Crawl runs asynchronously — pages appear as linkable progressively.
    const pages = workspaceId
      ? await getWorkspaceLinkablePages(workspaceId, tenantId)
      : [];

    return NextResponse.json({
      success: true,
      url: normalized,
      linkableNow: pages.length,
      note:
        "Crawl started. Pages become available as internal links progressively — check back in a minute.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
