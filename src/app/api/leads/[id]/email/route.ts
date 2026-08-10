import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/lib/leads/cipher";
import { getTenantId } from "@/lib/auth";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const tenantId = await getTenantId();
    const { id } = await context.params;
    const { subject, body } = await request.json();
    if (!subject || !body) return NextResponse.json({ error: "subject and body required" }, { status: 400 });
    const result = await sendEmail(tenantId, id, subject, body);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}