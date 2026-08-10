import { NextRequest, NextResponse } from "next/server";
import { getCallLogs, makeOutboundCall } from "@/lib/voice/haven";
import { getTenantId } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    const url = new URL(request.url);

    const { calls, total } = await getCallLogs({
      tenantId,
      leadId: url.searchParams.get("leadId") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
      limit: parseInt(url.searchParams.get("limit") ?? "20"),
      offset: parseInt(url.searchParams.get("offset") ?? "0"),
    });

    return NextResponse.json({ calls, total });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    const { phone, leadId, script } = await request.json();

    if (!phone) return NextResponse.json({ error: "phone is required" }, { status: 400 });

    const result = await makeOutboundCall(tenantId, phone, leadId, script);
    return NextResponse.json(result, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}