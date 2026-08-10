import { NextRequest, NextResponse } from "next/server";
import { syncSocialComments, getSocialInbox, type SocialInboxQuery } from "@/lib/inbox/echo";
import { getTenantId } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    const url = new URL(request.url);
    const query: SocialInboxQuery = {
      tenantId,
      status: (url.searchParams.get("status") as SocialInboxQuery["status"]) ?? undefined,
      platform: (url.searchParams.get("platform") as SocialInboxQuery["platform"]) ?? undefined,
      clientId: url.searchParams.get("clientId") ?? undefined,
      limit: parseInt(url.searchParams.get("limit") ?? "20", 10),
      offset: parseInt(url.searchParams.get("offset") ?? "0", 10),
    };

    const result = await getSocialInbox(query);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    const body = await request.json();
    const { postId } = body;

    if (!postId) {
      return NextResponse.json({ error: "postId is required" }, { status: 400 });
    }

    const results = await syncSocialComments(tenantId, postId);
    return NextResponse.json({ results });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}