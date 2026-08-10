import { NextRequest, NextResponse } from "next/server";
import { generateOutboundTwiml } from "@/lib/voice/haven";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const text = url.searchParams.get("text") ?? "Hello, this is a call from Agency OS.";

  const twiml = generateOutboundTwiml(decodeURIComponent(text));

  return new NextResponse(twiml, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}