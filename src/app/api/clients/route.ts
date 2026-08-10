import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { getCurrentWorkspaceId } from "@/lib/workspace";

export async function GET() {
  try {
    const tenantId = await getTenantId();
    const supabase = await createServiceClient();
    const workspaceId = await getCurrentWorkspaceId();

    let query = supabase.from("clients").select("id, name, website, notes, created_at").eq("tenant_id", tenantId);
    if (workspaceId) {
      // Include legacy clients with workspace_id = NULL so they appear in
      // every workspace view, alongside clients scoped to this workspace.
      query = query.or(`workspace_id.is.null,workspace_id.eq.${workspaceId}`);
    }
    query = query.order("name", { ascending: true });

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: "Failed to fetch clients", details: error }, { status: 500 });
    }

    return NextResponse.json({ clients: data ?? [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    const supabase = await createServiceClient();
    const workspaceId = await getCurrentWorkspaceId();

    const body = await request.json();
    const { name, website, notes } = body;

    if (!name || typeof name !== "string") {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("clients")
      .insert({
        tenant_id: tenantId,
        workspace_id: workspaceId || null,
        name,
        website: website || null,
        notes: notes || null,
      })
      .select("id, name, website, notes, created_at")
      .single();

    if (error) {
      return NextResponse.json({ error: "Failed to create client", details: error }, { status: 500 });
    }

    return NextResponse.json({ client: data }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}