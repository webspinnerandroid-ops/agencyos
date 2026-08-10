import { NextRequest, NextResponse } from "next/server";
import { importFromApollo } from "@/lib/leads/cipher";
import { getTenantId } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    const body = await request.json();
    const result = await importFromApollo(tenantId, body);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}