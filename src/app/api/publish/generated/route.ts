import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import {
  publishToConnectedSites,
} from "@/lib/publishing/connectedSitesPublisher";
import type {
  GeneratedContentTarget,
  GeneratedContentPayload,
} from "@/lib/publishing/wordpressPublisher";

/**
 * POST /api/publish/generated
 *
 * Publishes a freshly generated blog post (from the Generate Content page —
 * not yet saved in `posts`) straight to a chosen set of connected sites:
 * WordPress, Ghost, Medium, Webflow, or the built-in CMS site_pages.
 *
 * Body:
 *   targets: [{
 *     blogPlatformId,          // blog_platforms.id (or "builtin_cms")
 *     mode: "create" | "overwrite",
 *     kind: "post" | "page",   // what an overwrite replaces
 *     wpPostId?,               // required for overwrite
 *     includeImages,           // upload generated images to the site's media
 *                              // library, embed them, set featured image
 *     categoryId?
 *   }]
 *   content: { title, body, slug?, metaDescription?, seoMeta?, images[] }
 *
 * The tenant is taken from the session; every target site is fetched
 * tenant-scoped, so one request can never touch another tenant's sites.
 */
export async function POST(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    const body = await request.json();
    const targets = body?.targets as GeneratedContentTarget[] | undefined;
    const content = body?.content as GeneratedContentPayload | undefined;

    if (!Array.isArray(targets) || targets.length === 0) {
      return NextResponse.json(
        { error: "Select at least one connected site to publish to." },
        { status: 400 }
      );
    }
    if (!content || typeof content.title !== "string" || !content.title.trim()) {
      return NextResponse.json(
        { error: "Generated content is missing a title." },
        { status: 400 }
      );
    }
    if (!content.body || typeof content.body !== "string" || !content.body.trim()) {
      return NextResponse.json(
        { error: "Generated content is missing a body." },
        { status: 400 }
      );
    }

    const result = await publishToConnectedSites(
      tenantId,
      targets,
      content
    );

    return NextResponse.json({
      success: result.allSucceeded,
      results: result.results,
      message: result.allSucceeded
        ? "Published to all selected sites"
        : "Some sites failed — see per-site results",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Publish failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}