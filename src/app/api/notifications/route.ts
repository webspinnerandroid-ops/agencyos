import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { parseJsonBody } from "@/lib/api-validate";
import {
  notificationsDeleteSchema,
  notificationsMarkReadSchema,
} from "@/lib/validations";
import {
  listNotifications,
  countNotifications,
  getUnreadNotificationCount,
  getUnreadCountsByKind,
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

    const [notifications, unread, unreadByKind, total] = await Promise.all([
      listNotifications(tenantId, { limit, offset, kind }),
      getUnreadNotificationCount(tenantId),
      getUnreadCountsByKind(tenantId),
      countNotifications(tenantId, kind),
    ]);
    return NextResponse.json({ notifications, unread, unreadByKind, total });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/notifications
 *
 * Mark notifications read. Body: { ids?: uuid[], all?: boolean } — validated
 * by notificationsMarkReadSchema; an absent body (the bell's single "mark all"
 * action) still behaves as mark-all via emptyAsEmptyObject.
 * - `all: true` marks every unread notification read.
 * - Otherwise the `ids` array is marked read (an empty array is a no-op, per
 *   markNotificationsRead).
 *
 * Tightened: a non-array or non-uuid `ids` used to fall through to mark-all
 * silently; it is now a field-level 400.
 */
export async function POST(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    const body = await parseJsonBody(request, notificationsMarkReadSchema, {
      emptyAsEmptyObject: true,
    });
    if (!body.ok) return body.response;
    const ids = body.data.all === true ? null : (body.data.ids ?? null);
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
 * Delete notifications. Body: { ids: uuid[] } — an absent body or an empty
 * array is a no-op (deleteNotifications guards both).
 */
export async function DELETE(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    const body = await parseJsonBody(request, notificationsDeleteSchema, {
      emptyAsEmptyObject: true,
    });
    if (!body.ok) return body.response;
    const ids = body.data.ids ?? [];
    await deleteNotifications(tenantId, ids);
    return NextResponse.json({ success: true, deleted: ids.length });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
