import { NextRequest, NextResponse } from "next/server";
import { createVideoAsset, listMediaAssets } from "@/lib/media/flux";
import { getTenantId } from "@/lib/auth";
import { checkTrialContentLimit } from "@/lib/trial-limits";

export async function GET(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    const url = new URL(request.url);

    const { assets, total } = await listMediaAssets(tenantId, {
      type: "video",
      status: (url.searchParams.get("status") as "processing" | "completed" | "failed") ?? undefined,
      clientId: url.searchParams.get("clientId") ?? undefined,
      limit: parseInt(url.searchParams.get("limit") ?? "20"),
      offset: parseInt(url.searchParams.get("offset") ?? "0"),
    });

    return NextResponse.json({ assets, total });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const tenantId = await getTenantId();

    // Trial tenants: one video per week.
    const trial = await checkTrialContentLimit(tenantId, "video");
    if (!trial.allowed) {
      return NextResponse.json({ error: trial.reason }, { status: 429 });
    }

    const body = await request.json();

    const asset = await createVideoAsset(tenantId, body.prompt, {
      duration: body.duration,
      resolution: body.resolution,
      clientId: body.clientId,
      tags: body.tags,
      modelId: body.modelId,
    });

    // Track usage (1 video + a nominal token cost).
    const { incrementUsage } = await import("@/lib/usage");
    void incrementUsage(tenantId, "video_generations", 1);
    void incrementUsage(tenantId, "ai_tokens", 1000);

    return NextResponse.json({ asset }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}