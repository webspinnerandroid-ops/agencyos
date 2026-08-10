import { NextRequest, NextResponse } from "next/server";
import { getOutlookAuthUrl } from "@/lib/inbox/archer";
import { getTenantId } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    const authUrl = await getOutlookAuthUrl(tenantId);
    return NextResponse.redirect(authUrl);
  } catch (err: any) {
    console.error("[outlook-auth] Error:", err);
    return NextResponse.redirect(
      new URL("/dashboard/settings?error=outlook_auth_failed", request.url)
    );
  }
}