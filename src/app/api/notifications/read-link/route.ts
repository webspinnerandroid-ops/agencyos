import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { markNotificationsReadByLink } from "@/lib/in-app-notifications";

/**
 * POST /api/notifications/read-link
 *
 * Marks read every unread notification whose link matches the current page.
 * Fired by the client when a linked page is opened directly (not via the
 * bell), so the red dot clears once the work has been seen.
 * Body: { link: string }
 */
export async function POST(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    let body: { link?: string } = {};
    try {
      body = (await request.json()) as { link?: string };
    } catch {
      // no body — no-op
    }
    const link = typeof body.link === "string" ? body.link : "";
    await markNotificationsReadByLink(tenantId, link);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
