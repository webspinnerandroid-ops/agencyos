import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getTenantId } from "@/lib/auth";
import { parseJsonBody } from "@/lib/api-validate";
import { sequenceCreateSchema } from "@/lib/validations";

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
    const body = await parseJsonBody(request, sequenceCreateSchema);
    if (!body.ok) return body.response;
    const { name, description, steps, isActive } = body.data;

    const { data, error } = await supabase
      .from("sequences")
      .insert({
        tenant_id: tenantId,
        name,
        description: description ?? null,
        steps,
        is_active: isActive ?? false,
      })
      .select("id")
      .single();

    if (error) throw new Error(error.message);
    return NextResponse.json({ id: data.id }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}