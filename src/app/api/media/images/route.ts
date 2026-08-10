import { NextRequest, NextResponse } from "next/server";
import { createImageAsset, listMediaAssets } from "@/lib/media/flux";
import { getTenantId } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    const url = new URL(request.url);

    const { assets, total } = await listMediaAssets(tenantId, {
      type: "image",
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
    const body = await request.json();

    const asset = await createImageAsset(tenantId, body.prompt, {
      size: body.size,
      n: body.n,
      quality: body.quality,
      style: body.style,
      clientId: body.clientId,
      tags: body.tags,
    });

    return NextResponse.json({ asset }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}