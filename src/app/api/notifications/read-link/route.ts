import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { parseJsonBody } from "@/lib/api-validate";
import { notificationsReadLinkSchema } from "@/lib/validations";
import { markNotificationsReadByLink } from "@/lib/in-app-notifications";

/**
 * POST /api/notifications/read-link
 *
 * Marks read every unread notification whose link matches the current page.
 * Fired by the client when a linked page is opened directly (not via the
 * bell), so the red dot clears once the work has been seen.
 * Body: { link?: string } — validated by notificationsReadLinkSchema; an
 * absent body/link is still a no-op (matching nothing), not an error.
 */
export async function POST(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    const body = await parseJsonBody(request, notificationsReadLinkSchema, {
      emptyAsEmptyObject: true,
    });
    if (!body.ok) return body.response;
    const link = body.data.link ?? "";
    await markNotificationsReadByLink(tenantId, link);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
