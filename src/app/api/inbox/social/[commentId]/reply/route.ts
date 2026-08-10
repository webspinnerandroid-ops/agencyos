import { NextRequest, NextResponse } from "next/server";
import { replyToComment } from "@/lib/inbox/echo";
import { getTenantId } from "@/lib/auth";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ commentId: string }> }
) {
  try {
    const tenantId = await getTenantId();
    const { commentId } = await context.params;
    const { body: replyBody } = await request.json();

    if (!replyBody || typeof replyBody !== "string" || replyBody.trim().length === 0) {
      return NextResponse.json({ error: "reply body is required" }, { status: 400 });
    }

    const result = await replyToComment(tenantId, commentId, replyBody.trim());
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}