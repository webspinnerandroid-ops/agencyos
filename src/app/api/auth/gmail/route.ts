import { NextRequest, NextResponse } from "next/server";
import { getGmailAuthUrl } from "@/lib/inbox/archer";
import { getTenantId } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    const authUrl = await getGmailAuthUrl(tenantId);
    return NextResponse.redirect(authUrl);
  } catch (err: any) {
    console.error("[gmail-auth] Error:", err);
    return NextResponse.redirect(
      new URL("/dashboard/settings?error=gmail_auth_failed", request.url)
    );
  }
}