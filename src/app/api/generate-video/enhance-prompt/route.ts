import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { generateStructuredOutput } from "@/lib/ai/orchestrator";

/**
 * POST /api/generate-video/enhance-prompt
 * Body: { prompt: string }
 *
 * Expands a brief idea into a detailed, professional video-generation prompt
 * (subject, scene, motion, camera, lighting, mood, duration hints). Uses the
 * tenant's configured text model, so it works with whatever text provider is
 * set in AI Settings (DeepSeek, OpenAI, etc.).
 */
export async function POST(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    if (!tenantId) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const prompt = (body?.prompt as string)?.trim();
    if (!prompt) {
      return NextResponse.json({ error: "prompt is required" }, { status: 400 });
    }
    if (prompt.length > 2000) {
      return NextResponse.json({ error: "Prompt too long (max 2000 chars)" }, { status: 400 });
    }

    const enhanced = await generateStructuredOutput<{ enhancedPrompt: string }>(
      "team_chat",
      `You are an expert AI video prompt engineer for text-to-video and
image-to-video models (Wan, Runway, Pika, Kling). Expand a brief concept into a
rich, professional prompt. Include: subject, scene and setting, camera movement
and angle, lighting, motion and dynamics, style and mood, color palette, and
level of detail. Keep it vivid but concrete — describe visible action, not
abstract adjectives. Between 80-200 words. Return JSON: { "enhancedPrompt":
string } with ONLY the prompt text in that field.`,
      `Video concept: ${prompt}`,
      tenantId,
      {
        type: "object",
        properties: { enhancedPrompt: { type: "string" } },
        required: ["enhancedPrompt"],
      },
      { temperature: 0.8, maxTokens: 500, functionName: "enhance_video_prompt" }
    );

    const enhancedPrompt = enhanced?.enhancedPrompt?.trim();
    if (!enhancedPrompt) {
      return NextResponse.json({ error: "Enhancement failed — try again" }, { status: 500 });
    }
    return NextResponse.json({ enhancedPrompt });
  } catch (err: any) {
    const message = err?.message ?? "Internal error";
    const noKey = message.includes("No API key") || message.includes("no provider");
    return NextResponse.json(
      { error: noKey ? "No text model API key configured. Add one in AI Settings → API Keys." : message },
      { status: 500 }
    );
  }
}
