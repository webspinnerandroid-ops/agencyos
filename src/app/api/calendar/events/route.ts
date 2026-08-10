import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { syncCalendar, createEvent, type CreateEventInput } from "@/lib/inbox/archer";
import { getTenantId } from "@/lib/auth";

function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    const supabase = getServiceSupabase();
    const url = new URL(request.url);
    const days = parseInt(url.searchParams.get("days") ?? "30", 10);

    const { data: events, error } = await supabase
      .from("calendar_events")
      .select("*")
      .eq("tenant_id", tenantId)
      .gte("start_time", new Date().toISOString())
      .order("start_time", { ascending: true })
      .limit(100);

    if (error) throw new Error(error.message);

    return NextResponse.json({ events: events ?? [], days });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    const body = await request.json();

    if (body.action === "sync") {
      const { accountId } = body;
      if (!accountId) {
        return NextResponse.json({ error: "accountId is required" }, { status: 400 });
      }
      const result = await syncCalendar(accountId, tenantId, body.days ?? 30);
      return NextResponse.json(result);
    }

    if (body.action === "create") {
      const { accountId, ...input } = body as CreateEventInput & { accountId: string; action: string };
      if (!accountId) {
        return NextResponse.json({ error: "accountId is required" }, { status: 400 });
      }
      const event = await createEvent(accountId, tenantId, input);
      return NextResponse.json({ event });
    }

    return NextResponse.json({ error: "Invalid action. Use 'sync' or 'create'." }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}