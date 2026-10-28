import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/lib/leads/cipher";
import { getTenantId } from "@/lib/auth";
import { parseJsonBody } from "@/lib/api-validate";
import { leadEmailSchema } from "@/lib/validations";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const tenantId = await getTenantId();
    const { id } = await context.params;
    const body = await parseJsonBody(request, leadEmailSchema);
    if (!body.ok) return body.response;
    const result = await sendEmail(tenantId, id, body.data.subject, body.data.body);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}