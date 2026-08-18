import { NextResponse } from "next/server";

/**
 * GET /api/version — the git SHA baked into this build (next.config env).
 * Public on purpose: opening it in a phone browser instantly tells you
 * whether the device is on the newest deployed bundle.
 */
export async function GET() {
  return NextResponse.json({
    version: process.env.NEXT_PUBLIC_BUILD_SHA ?? "unknown",
    servedAt: new Date().toISOString(),
  });
}
