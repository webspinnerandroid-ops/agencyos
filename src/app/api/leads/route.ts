import { NextRequest, NextResponse } from "next/server";
import { getLeads, createLead } from "@/lib/leads/cipher";
import { getTenantId } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    const url = new URL(request.url);

    const { leads, total } = await getLeads({
      tenantId,
      status: url.searchParams.get("status") ?? undefined,
      source: url.searchParams.get("source") ?? undefined,
      clientId: url.searchParams.get("clientId") ?? undefined,
      search: url.searchParams.get("search") ?? undefined,
      limit: parseInt(url.searchParams.get("limit") ?? "20"),
      offset: parseInt(url.searchParams.get("offset") ?? "0"),
    });

    return NextResponse.json({ leads, total });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    const body = await request.json();
    const result = await createLead(tenantId, body);
    return NextResponse.json(result, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}