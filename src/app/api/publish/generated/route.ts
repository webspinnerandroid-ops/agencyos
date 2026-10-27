import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import {
  publishToConnectedSites,
} from "@/lib/publishing/connectedSitesPublisher";
import type {
  GeneratedContentTarget,
  GeneratedContentPayload,
} from "@/lib/publishing/wordpressPublisher";
import { parseJsonBody } from "@/lib/api-validate";
import { publishGeneratedSchema } from "@/lib/validations";

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
    const body = await parseJsonBody(request, publishGeneratedSchema);
    if (!body.ok) return body.response;
    const targets: GeneratedContentTarget[] = body.data.targets.map((t) => ({
      ...t,
      includeImages: t.includeImages ?? false,
    }));
    // The publisher's payload type requires an images array (possibly empty).
    const content: GeneratedContentPayload = {
      ...body.data.content,
      images: body.data.content.images ?? [],
    };
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