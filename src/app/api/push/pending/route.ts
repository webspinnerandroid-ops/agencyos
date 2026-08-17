import { NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import {
  listNotifications,
  getUnreadNotificationCount,
} from "@/lib/in-app-notifications";

/**
 * GET /api/push/pending — the payload a service-worker push event shows.
 *
 * The service worker calls this (its same-origin fetch carries the session
 * cookie, so the middleware authenticates it like any page request) and
 * renders the latest unread notifications as the device notification.
 */
export async function GET() {
  try {
    const tenantId = await getTenantId();
    const [count, items] = await Promise.all([
      getUnreadNotificationCount(tenantId),
      listNotifications(tenantId, { limit: 5 }),
    ]);
    return NextResponse.json({
      count,
      items: items.map((n) => ({
        kind: n.kind,
        title: n.title,
        body: n.body,
        link: n.link,
        createdAt: n.created_at,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}