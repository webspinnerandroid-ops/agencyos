import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";

/**
 * POST /api/generate-image/enhance-prompt
 *
 * Takes a brief user prompt and uses DeepSeek's LLM to expand it into a
 * detailed, professional image-generation prompt.
 *
 * Body: { prompt: string }
 */
export async function POST(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    if (!tenantId) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    let body: { prompt?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const prompt = body?.prompt?.trim();
    if (!prompt) {
      return NextResponse.json({ error: "prompt is required" }, { status: 400 });
    }

    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "DeepSeek API key is not configured. Set DEEPSEEK_API_KEY in the server environment." },
        { status: 500 }
      );
    }

    // Call DeepSeek chat completions API
    const deepseekRes = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          {
            role: "system",
            content:
              "You are an expert AI image prompt engineer. Your task is to take a brief, simple image concept and expand it into a detailed, rich, professional AI image generation prompt. Include: subject, setting/environment, lighting, composition, camera angle, style, mood, color palette, level of detail, and any relevant technical photography terms. Keep it focused, vivid, and between 150-300 words. Return ONLY the expanded prompt text — no quotes, no preamble, no markdown.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        max_tokens: 500,
        temperature: 0.8,
      }),
    });

    if (!deepseekRes.ok) {
      const errText = await deepseekRes.text();
      console.error("[enhance-prompt] DeepSeek error:", deepseekRes.status, errText.slice(0, 300));
      return NextResponse.json(
        { error: "DeepSeek API error", details: `Status ${deepseekRes.status}: ${errText.slice(0, 200)}` },
        { status: 502 }
      );
    }

    const data = await deepseekRes.json();
    const enhanced = data?.choices?.[0]?.message?.content?.trim();

    if (!enhanced) {
      return NextResponse.json({ error: "DeepSeek returned no expanded prompt" }, { status: 502 });
    }

    return NextResponse.json({ enhancedPrompt: enhanced, originalPrompt: prompt });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    console.error("[enhance-prompt] Unexpected error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}