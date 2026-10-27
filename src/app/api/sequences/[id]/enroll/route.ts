import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getTenantId } from "@/lib/auth";
import { parseJsonBody } from "@/lib/api-validate";
import { sequenceEnrollSchema } from "@/lib/validations";

function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const tenantId = await getTenantId();
    const { id: sequenceId } = await context.params;
    const supabase = getServiceSupabase();
    const parsed = await parseJsonBody(request, sequenceEnrollSchema);
    if (!parsed.ok) return parsed.response;
    const { leadId } = parsed.data;

    // Get the sequence to determine first step delay
    const { data: sequence, error: seqErr } = await supabase
      .from("sequences")
      .select("steps")
      .eq("id", sequenceId)
      .eq("tenant_id", tenantId)
      .single();

    if (seqErr || !sequence) {
      return NextResponse.json({ error: "Sequence not found" }, { status: 404 });
    }

    const steps = sequence.steps ?? [];
    const firstDelay = steps.length > 0 ? (steps[0]?.delay_days ?? 0) : 0;
    const nextActionAt = new Date(Date.now() + firstDelay * 86400000).toISOString();

    const { data, error } = await supabase
      .from("sequence_enrollments")
      .upsert(
        {
          lead_id: leadId,
          sequence_id: sequenceId,
          tenant_id: tenantId,
          current_step: 0,
          next_action_at: nextActionAt,
        },
        { onConflict: "lead_id,sequence_id" }
      )
      .select("id")
      .single();

    if (error) throw new Error(error.message);
    return NextResponse.json({ enrollmentId: data.id }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}