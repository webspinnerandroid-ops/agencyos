import { NextRequest, NextResponse } from "next/server";
import { handleGatherResponse } from "@/lib/voice/haven";
import { createClient } from "@supabase/supabase-js";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const callSid = formData.get("CallSid") as string;
    const speechResult = formData.get("SpeechResult") as string;

    if (!callSid) {
      return NextResponse.json({ error: "Missing CallSid" }, { status: 400 });
    }

    // Resolve tenant from the call log
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: callLog } = await supabase
      .from("call_logs")
      .select("tenant_id")
      .eq("twilio_call_sid", callSid)
      .single();

    const tenantId = callLog?.tenant_id ?? "";

    const twiml = await handleGatherResponse(callSid, speechResult ?? "", tenantId);

    return new NextResponse(twiml, {
      status: 200,
      headers: { "Content-Type": "text/xml" },
    });
  } catch (err: any) {
    console.error("[voice/incoming/respond] Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}