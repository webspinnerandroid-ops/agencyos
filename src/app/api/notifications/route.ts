import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import {
  listNotifications,
  countNotifications,
  getUnreadNotificationCount,
  markNotificationsRead,
  deleteNotifications,
  type NotificationKind,
} from "@/lib/in-app-notifications";

const VALID_KINDS = new Set<NotificationKind>([
  "info",
  "progress",
  "approval",
  "alert",
]);

/**
 * GET /api/notifications
 *
 * Returns the tenant's recent notifications plus the unread count, for the
 * top-nav bell and the notifications center page.
 *
 * Query: ?kind=info|progress|approval|alert&limit=30&offset=0
 * All reads go through the service client but are explicitly scoped to the
 * caller's tenant (RLS on this table is a no-access deny-all, so only this
 * route reads it).
 */
export async function GET(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    const { searchParams } = request.nextUrl;
    const kindParam = searchParams.get("kind");
    const kind = kindParam && VALID_KINDS.has(kindParam as NotificationKind)
      ? (kindParam as NotificationKind)
      : null;
    const limit = Math.min(Math.max(Number(searchParams.get("limit")) || 30, 1), 50);
    const offset = Math.max(Number(searchParams.get("offset")) || 0, 0);

    const [notifications, unread, total] = await Promise.all([
      listNotifications(tenantId, { limit, offset, kind }),
      getUnreadNotificationCount(tenantId),
      countNotifications(tenantId, kind),
    ]);
    return NextResponse.json({ notifications, unread, total });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/notifications
 *
 * Mark notifications read. Body: { ids?: string[], all?: boolean }.
 * - `all: true` marks every unread notification read.
 * - Otherwise a specific `ids` array is marked read.
 */
export async function POST(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    let body: { ids?: string[]; all?: boolean } = {};
    try {
      body = (await request.json()) as { ids?: string[]; all?: boolean };
    } catch {
      // empty body → treat as mark-all (the bell's single "mark all" action)
    }
    const markAll = body.all === true;
    const ids = markAll ? null : Array.isArray(body.ids) ? body.ids : null;
    await markNotificationsRead(tenantId, ids);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/notifications
 *
 * Delete notifications. Body: { ids: string[] } — empty array is a no-op.
 */
export async function DELETE(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    let body: { ids?: string[] } = {};
    try {
      body = (await request.json()) as { ids?: string[] };
    } catch {
      // fall through — no ids, no-op
    }
    const ids = Array.isArray(body.ids) ? body.ids : [];
    await deleteNotifications(tenantId, ids);
    return NextResponse.json({ success: true, deleted: ids.length });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
