import { NextResponse } from "next/server";
import { getVapidPublicKey } from "@/lib/web-push";

/** GET /api/push/vapid-key — the public key for PushManager.subscribe. */
export async function GET() {
  const key = await getVapidPublicKey();
  if (!key) {
    return NextResponse.json({ error: "Push not configured" }, { status: 500 });
  }
  return NextResponse.json({ key });
}