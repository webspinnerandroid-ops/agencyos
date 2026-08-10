import { NextRequest, NextResponse } from "next/server";
import { getCallLog } from "@/lib/voice/haven";
import { getTenantId } from "@/lib/auth";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const tenantId = await getTenantId();
    const { id } = await context.params;
    const call = await getCallLog(tenantId, id);
    return NextResponse.json({ call });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}