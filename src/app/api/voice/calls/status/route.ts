import { NextRequest, NextResponse } from "next/server";
import { handleCallComplete } from "@/lib/voice/haven";

/**
 * Twilio status callback webhook. Twilio POSTs here when a call ends.
 * Updates the call_logs record with the final status.
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const callSid = formData.get("CallSid") as string;
    const callStatus = formData.get("CallStatus") as string;
    const duration = formData.get("CallDuration") as string;

    if (!callSid) {
      return NextResponse.json({ error: "Missing CallSid" }, { status: 400 });
    }

    if (callStatus === "completed" || callStatus === "failed" || callStatus === "busy" || callStatus === "no-answer") {
      await handleCallComplete(callSid, parseInt(duration ?? "0"));
    }

    return NextResponse.json({ received: true });
  } catch (err: any) {
    console.error("[voice/calls/status] Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}