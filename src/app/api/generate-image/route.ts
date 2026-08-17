import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { generateImage } from "@/lib/ai/orchestrator";
import { incrementUsage } from "@/lib/usage";
import { createServiceClient } from "@/lib/supabase/server";
import { getCurrentWorkspaceId } from "@/lib/workspace";
import { checkUsageLimit } from "@/lib/plan-limits";
import { checkTokenBalance } from "@/lib/token-billing";
import { rateLimitRequest } from "@/lib/rate-limit";
import { persistImageToStorage } from "@/lib/media/storage";
import { checkTrialContentLimit } from "@/lib/trial-limits";
import { buildWorkspacePromptContext, augmentPromptWithContext } from "@/lib/ai/workspace-context";

export async function POST(request: NextRequest) {
  try {
    // Rate limit (abuse protection — each generation hits an image model)
    const rl = rateLimitRequest(request, "generate-image", 15);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: `Rate limit exceeded. Try again in ${rl.retryAfterSeconds}s.` },
        {
          status: 429,
          headers: { "Retry-After": String(rl.retryAfterSeconds) },
        }
      );
    }

    const tenantId = await getTenantId();
    const workspaceId = await getCurrentWorkspaceId();
    const supabase = await createServiceClient();

    // Trial tenants: one image per week. Paid plans: monthly per-tier cap.
    const trial = await checkTrialContentLimit(tenantId, "image");
    if (!trial.allowed) {
      return NextResponse.json({ error: trial.reason }, { status: 429 });
    }
    const plan = await checkUsageLimit(tenantId, "image_generations");
    if (!plan.allowed) {
      return NextResponse.json({ error: plan.reason ?? "Monthly image limit reached" }, { status: 429 });
    }

    // Token-billing balance gate (402 + buyMoreTokens when exhausted).
    const bal = await checkTokenBalance(tenantId);
    if (!bal.allowed) {
      return NextResponse.json(
        { error: bal.reason, buyMoreTokens: true, balance: bal.balance },
        { status: 402 }
      );
    }

    let body: { prompt: string; size?: string; n?: number; clientId?: string; referenceImage?: string; task?: string; modelId?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { prompt, size, n, clientId, referenceImage, task, modelId } = body;

    if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
      return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
    }

    if (prompt.length > 4000) {
      return NextResponse.json({ error: "Prompt too long (max 4000 characters)" }, { status: 400 });
    }

    // Ground the prompt in the workspace brand profile + knowledgebase so
    // standalone image generation matches the client's look and content.
    const { context } = await buildWorkspacePromptContext(tenantId);
    const groundedPrompt = augmentPromptWithContext(prompt, context);

    // Generate images using configured provider (DALL-E, Stability, Google Imagen)
    const rawImages = await generateImage(tenantId, groundedPrompt, {
      size: (size as any) ?? "1024x1024",
      n: n ?? 1,
      clientId: clientId ?? undefined,
      referenceImage: referenceImage ?? undefined,
      task: task === "brand_design" ? "brand_design" : "image_generation",
      modelId: modelId ?? undefined,
    });

    // Persist to Supabase Storage. Providers like Google Imagen return base64
    // data-URLs (~2-3 MB each); storing those raw in media_assets made the
    // Recent Images API a 50 MB response and the page take ~25s. The DB row
    // now stores only the short public URL.
    const images = await Promise.all(
      rawImages.map(async (img) => ({
        ...img,
        url: await persistImageToStorage(tenantId, img.url),
      }))
    );

    // Track usage
    void incrementUsage(tenantId, "ai_tokens", images.length * 1000);
    void incrementUsage(tenantId, "image_generations", images.length);

    // Save generated images to media_assets for recent images history
    const savedAssets: unknown[] = [];
    for (const img of images) {
      try {
        const { data: asset, error: insertErr } = await supabase
          .from("media_assets")
          .insert({
            tenant_id: tenantId,
            client_id: clientId ?? null,
            workspace_id: workspaceId ?? null,
            type: "image",
            prompt: prompt.trim(),
            url: img.url,
            metadata: {
              size: size ?? "1024x1024",
              revisedPrompt: img.revisedPrompt ?? null,
            },
            status: "completed",
          })
          .select("id, url, prompt, created_at")
          .single();

        if (!insertErr && asset) {
          savedAssets.push(asset);
        } else if (insertErr) {
          console.error("[generate-image] Failed to save to media_assets:", insertErr.message, insertErr.code);
        }
      } catch (e: any) {
        console.error("[generate-image] Exception saving to media_assets:", e?.message ?? e);
      }
    }

    return NextResponse.json({
      success: true,
      images: images.map((img) => ({
        url: img.url,
        revisedPrompt: img.revisedPrompt ?? null,
      })),
      saved: savedAssets.length,
      totalGenerated: images.length,
    });
  } catch (error: any) {
    console.error("[generate-image] Error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    const status = error?.status ?? 500;
    return NextResponse.json({ error: message }, { status });
  }
}
