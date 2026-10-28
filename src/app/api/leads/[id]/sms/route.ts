import { NextRequest, NextResponse } from "next/server";
import { sendSMS } from "@/lib/leads/cipher";
import { getTenantId } from "@/lib/auth";
import { parseJsonBody } from "@/lib/api-validate";
import { leadSmsSchema } from "@/lib/validations";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const tenantId = await getTenantId();
    const { id } = await context.params;
    const body = await parseJsonBody(request, leadSmsSchema);
    if (!body.ok) return body.response;
    const result = await sendSMS(tenantId, id, body.data.body);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}