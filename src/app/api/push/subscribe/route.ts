import { NextRequest, NextResponse } from "next/server";
import { getTenantId, getUserId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { parseJsonBody } from "@/lib/api-validate";
import {
  pushSubscribeSchema,
  pushUnsubscribeSchema,
} from "@/lib/validations";

/**
 * POST /api/push/subscribe — store a browser push subscription.
 *
 * Auth is enforced by the middleware (session cookie); the user + tenant are
 * read from the auth cookies the middleware sets.
 *
 * Body: { endpoint, keys: { p256dh, auth } } — validated by
 * pushSubscribeSchema; the old all-or-nothing truthiness check became
 * field-level 400s (which field is missing / non-https, etc).
 */
export async function POST(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    const userId = await getUserId();
    if (!userId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const body = await parseJsonBody(request, pushSubscribeSchema);
    if (!body.ok) return body.response;
    const { endpoint } = body.data;
    const { p256dh, auth } = body.data.keys;

    const supabase = await createServiceClient();
    const { error } = await supabase.from("push_subscriptions").upsert(
      {
        user_id: userId,
        tenant_id: tenantId,
        endpoint,
        p256dh,
        auth,
        user_agent: request.headers.get("user-agent")?.slice(0, 300) ?? null,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "endpoint" }
    );
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** DELETE /api/push/subscribe — remove a subscription (opt-out / logout). */
export async function DELETE(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    const body = await parseJsonBody(request, pushUnsubscribeSchema);
    if (!body.ok) return body.response;
    const supabase = await createServiceClient();
    const { error } = await supabase
      .from("push_subscriptions")
      .delete()
      .eq("endpoint", body.data.endpoint)
      .eq("tenant_id", tenantId);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
