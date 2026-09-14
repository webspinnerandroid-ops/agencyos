import { NextRequest, NextResponse } from "next/server";
import { authenticateMachineKey, hasScope } from "@/lib/agency/api-keys";
import { createServiceClient } from "@/lib/supabase/server";
import { record } from "@/lib/agency/ledger";

/**
 * Machine API — clients + subsystems (Phase 7).
 *
 * GET /api/agency/clients              → clients for the key's tenant (scope: read)
 * GET /api/agency/clients?clientId=... → one client + subsystem map (scope: read)
 */
export async function GET(request: NextRequest) {
  const ctx = await authenticateMachineKey(request.headers.get("authorization"));
  if (!ctx) {
    return NextResponse.json({ error: "Valid machine key required" }, { status: 401 });
  }
  if (!hasScope(ctx, "read")) {
    return NextResponse.json({ error: "read scope required" }, { status: 403 });
  }

  const supabase = await createServiceClient();
  const clientId = request.nextUrl.searchParams.get("clientId");

  if (clientId) {
    // Tenant-scoped by the KEY's tenant — never by a request parameter.
    const { data: client } = await supabase
      .from("clients")
      .select("id, name, website, email, workspace_id")
      .eq("id", clientId)
      .eq("tenant_id", ctx.tenantId)
      .maybeSingle();
    if (!client) {
      // 404, not 403 — don't confirm existence of other tenants' rows.
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    const { data: subsystems } = await supabase
      .from("client_subsystems")
      .select("subsystem, resource_id, resource_url, provisioned_at, metadata")
      .eq("client_id", clientId)
      .eq("tenant_id", ctx.tenantId);
    return NextResponse.json({ client, subsystems: subsystems ?? [] });
  }

  const { data: clients } = await supabase
    .from("clients")
    .select("id, name, website, email, workspace_id")
    .eq("tenant_id", ctx.tenantId)
    .order("created_at", { ascending: false })
    .limit(200);
  await record({
    tenantId: ctx.tenantId,
    actor: { kind: "api", keyId: ctx.keyId },
    type: "client",
    summary: `Machine API list-clients (${ctx.name})`,
    source: "api",
  });
  return NextResponse.json({ clients: clients ?? [] });
}
