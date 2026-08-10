import { NextRequest, NextResponse } from "next/server";
import { enrichLead } from "@/lib/leads/cipher";
import { getTenantId } from "@/lib/auth";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const tenantId = await getTenantId();
    const { id } = await context.params;
    const result = await enrichLead(tenantId, id);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}