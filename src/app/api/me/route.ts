import { NextResponse } from "next/server"
import { getTenantId, getRole } from "@/lib/auth"

export async function GET() {
  try {
    const tenantId = await getTenantId()
    const role = await getRole()

    return NextResponse.json({
      authenticated: true,
      tenant_id: tenantId,
      role,
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown authentication error"

    return NextResponse.json(
      { authenticated: false, error: message },
      { status: 401 }
    )
  }
}