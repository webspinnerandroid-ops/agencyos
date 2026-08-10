import { NextRequest, NextResponse } from "next/server";
import { sendSMS } from "@/lib/leads/cipher";
import { getTenantId } from "@/lib/auth";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const tenantId = await getTenantId();
    const { id } = await context.params;
    const { body } = await request.json();
    if (!body) return NextResponse.json({ error: "body is required" }, { status: 400 });
    const result = await sendSMS(tenantId, id, body);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}