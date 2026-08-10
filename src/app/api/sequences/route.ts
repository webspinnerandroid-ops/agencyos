import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getTenantId } from "@/lib/auth";

function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    const supabase = getServiceSupabase();

    const { data, error } = await supabase
      .from("sequences")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);
    return NextResponse.json({ sequences: data ?? [] });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    const supabase = getServiceSupabase();
    const body = await request.json();

    if (!body.name || !body.steps) {
      return NextResponse.json({ error: "name and steps are required" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("sequences")
      .insert({
        tenant_id: tenantId,
        name: body.name,
        description: body.description ?? null,
        steps: body.steps,
        is_active: body.isActive ?? false,
      })
      .select("id")
      .single();

    if (error) throw new Error(error.message);
    return NextResponse.json({ id: data.id }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}