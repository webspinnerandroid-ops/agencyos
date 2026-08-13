import { NextRequest, NextResponse } from "next/server";
import { getIndexNowKey } from "@/lib/indexnow";

/**
 * IndexNow verification file — served at https://<host>/<key>.txt.
 * Search engines fetch this to confirm the domain owns the key before
 * accepting submission pings. Public by design; only returns the key for
 * hosts registered in indexnow_keys.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ key?: string }> }
) {
  const key = (await params).key ?? "";
  if (!/^[a-f0-9]{32,64}$/i.test(key)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const host = (request.headers.get("host") ?? "").toLowerCase();
  const stored = await getIndexNowKey(host);
  if (!stored || stored !== key.toLowerCase()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return new NextResponse(key.toLowerCase(), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
