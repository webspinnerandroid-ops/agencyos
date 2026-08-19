import { NextRequest, NextResponse } from "next/server";
import { createVideoAsset, listMediaAssets } from "@/lib/media/flux";
import { getTenantId, getRole } from "@/lib/auth";
import { checkTrialContentLimit } from "@/lib/trial-limits";
import { checkUsageLimit } from "@/lib/plan-limits";
import { checkTokenBalance } from "@/lib/token-billing";
import { buildWorkspacePromptContext, augmentPromptWithContext } from "@/lib/ai/workspace-context";
import { getCurrentWorkspaceId } from "@/lib/workspace";
import { syncAssetToDrive } from "@/lib/drive-sync";

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

    // Lazy Drive pickup: async videos finish after the POST returns. The
    // Asset Library polls this list while a video is processing, so the first
    // poll that sees a completed URL kicks off the auto-save (only when the
    // toggle is on — syncAssetToDrive skips otherwise). Fire-and-forget.
    for (const a of assets) {
      if (a.status !== "completed" || !a.url || a.drive_synced_at) continue;
      void syncAssetToDrive({
        id: a.id,
        tenant_id: a.tenant_id,
        type: a.type,
        prompt: a.prompt,
        url: a.url,
      }).then((r) => {
        if (r.saved) console.log("[media/videos] drive auto-saved:", r.file?.name);
        else if (r.skipped && r.skipped !== "auto-save off" && r.skipped !== "already synced") {
          console.warn("[media/videos] drive auto-save skipped:", r.skipped);
        }
      });
    }

    return NextResponse.json({ assets, total });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const tenantId = await getTenantId();

    // Trial tenants: one video per week. Paid plans: monthly per-tier cap.
    const trial = await checkTrialContentLimit(tenantId, "video");
    if (!trial.allowed) {
      return NextResponse.json({ error: trial.reason }, { status: 429 });
    }
    const plan = await checkUsageLimit(tenantId, "video_generations");
    if (!plan.allowed) {
      return NextResponse.json({ error: plan.reason ?? "Monthly video limit reached" }, { status: 429 });
    }

    // Token-billing balance gate (402 + buyMoreTokens when exhausted).
    // Super admins (the platform owner) are never gated.
    const bal = await checkTokenBalance(tenantId, await getRole());
    if (!bal.allowed) {
      return NextResponse.json(
        { error: bal.reason, buyMoreTokens: true, balance: bal.balance },
        { status: 402 }
      );
    }

    const body = await request.json();

    // Ground the prompt in the workspace brand profile + knowledgebase so
    // standalone video generation matches the client's look and content.
    const { context } = await buildWorkspacePromptContext(tenantId);
    const groundedPrompt = augmentPromptWithContext(body.prompt ?? "", context);

    const asset = await createVideoAsset(tenantId, groundedPrompt, {
      duration: body.duration,
      resolution: body.resolution,
      clientId: body.clientId,
      tags: body.tags,
      modelId: body.modelId,
      imageUrl: body.imageUrl,
      modelIdentifier: body.modelIdentifier,
      mode: body.mode,
    });

    // Mirror finished videos into the attached Drive folder when auto-save
    // is on. Async videos (still processing) are picked up by the GET lazy
    // pickup above once their URL lands.
    if (asset.url) {
      const workspaceId = await getCurrentWorkspaceId().catch(() => null);
      void syncAssetToDrive(
        {
          id: asset.id,
          tenant_id: tenantId,
          workspace_id: workspaceId ?? null,
          type: asset.type,
          prompt: asset.prompt,
          url: asset.url,
        },
        workspaceId ?? null
      ).then((r) => {
        if (r.saved) console.log("[media/videos] drive auto-saved:", r.file?.name);
        else if (r.skipped && r.skipped !== "auto-save off") {
          console.warn("[media/videos] drive auto-save skipped:", r.skipped);
        }
      });
    }

    // Track usage (1 video + a nominal token cost).
    const { incrementUsage } = await import("@/lib/usage");
    void incrementUsage(tenantId, "video_generations", 1);
    void incrementUsage(tenantId, "ai_tokens", 1000);

    return NextResponse.json({ asset }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}