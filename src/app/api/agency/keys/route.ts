import { NextRequest, NextResponse } from "next/server";
import { getTenantId, getRole, getUserId } from "@/lib/auth";
import {
  authenticateMachineKey,
  createMachineKey,
  listMachineKeys,
  revokeMachineKey,
  MachineScope,
} from "@/lib/agency/api-keys";
import { record } from "@/lib/agency/ledger";

/**
 * Machine API key management (Phase 7).
 *
 * GET    /api/agency/keys          → list this tenant's keys (session auth)
 * POST   /api/agency/keys          → mint a key (agency_admin+; raw key shown ONCE)
 * DELETE /api/agency/keys?id=...   → revoke (agency_admin+)
 */
export async function GET() {
  try {
    const tenantId = await getTenantId();
    await getRole();
    return NextResponse.json({ keys: await listMachineKeys(tenantId) });
  } catch {
    return NextResponse.json({ error: "Session auth required" }, { status: 401 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    const role = await getRole();
    if (role !== "agency_admin" && role !== "super_admin") {
      return NextResponse.json({ error: "agency_admin role required" }, { status: 403 });
    }
    const userId = await getUserId();
    const body = (await request.json().catch(() => ({}))) as {
      name?: string;
      scopes?: MachineScope[];
    };
    if (!body.name || !body.name.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    const created = await createMachineKey({
      tenantId,
      name: body.name.trim(),
      scopes: body.scopes ?? ["read"],
      createdBy: userId,
    });
    await record({
      tenantId,
      actor: userId ? { kind: "user", userId } : { kind: "system" },
      type: "client",
      summary: `Machine API key "${created.name}" created (scopes: ${created.scopes.join(", ")})`,
    });
    // The raw key appears exactly once, in this response.
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    const role = await getRole();
    if (role !== "agency_admin" && role !== "super_admin") {
      return NextResponse.json({ error: "agency_admin role required" }, { status: 403 });
    }
    const keyId = request.nextUrl.searchParams.get("id");
    if (!keyId) return NextResponse.json({ error: "id is required" }, { status: 400 });
    const result = await revokeMachineKey(tenantId, keyId);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 404 });
    await record({
      tenantId,
      actor: { kind: "system" },
      type: "client",
      summary: `Machine API key ${keyId} revoked`,
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Session auth required" }, { status: 401 });
  }
}
