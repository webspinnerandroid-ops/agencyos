import { NextRequest, NextResponse } from "next/server";
import { getTenantId, getUserId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * POST /api/push/subscribe — store a browser push subscription.
 *
 * Auth is enforced by the middleware (session cookie); the user + tenant are
 * read from the auth cookies the middleware sets.
 */
export async function POST(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    const userId = await getUserId();
    if (!userId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    let body: {
      endpoint?: string;
      keys?: { p256dh?: string; auth?: string };
    };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const endpoint = body?.endpoint?.trim();
    const p256dh = body?.keys?.p256dh?.trim();
    const auth = body?.keys?.auth?.trim();
    if (!endpoint || !/^https:\/\//.test(endpoint) || !p256dh || !auth) {
      return NextResponse.json(
        { error: "endpoint, p256dh and auth (https) are required" },
        { status: 400 }
      );
    }

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
    let body: { endpoint?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    if (!body?.endpoint) {
      return NextResponse.json({ error: "endpoint is required" }, { status: 400 });
    }
    const supabase = await createServiceClient();
    const { error } = await supabase
      .from("push_subscriptions")
      .delete()
      .eq("endpoint", body.endpoint)
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