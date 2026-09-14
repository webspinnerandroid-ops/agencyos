import { NextRequest, NextResponse } from "next/server";
import { handleIncomingCall } from "@/lib/voice/haven";
import { safeFormData, unsupportedMediaResponse, internalErrorResponse } from "@/lib/api-http";

export async function POST(request: NextRequest) {
  try {
    const formData = await safeFormData(request);
    if (!formData) return unsupportedMediaResponse();
    const callSid = formData.get("CallSid") as string;
    const from = formData.get("From") as string;
    const to = formData.get("To") as string;

    if (!callSid) {
      return NextResponse.json({ error: "Missing CallSid" }, { status: 400 });
    }

    const twiml = await handleIncomingCall(callSid, from ?? "", to ?? "");

    return new NextResponse(twiml, {
      status: 200,
      headers: { "Content-Type": "text/xml" },
    });
  } catch (err: any) {
    return internalErrorResponse(err, "voice/incoming");
  }
}