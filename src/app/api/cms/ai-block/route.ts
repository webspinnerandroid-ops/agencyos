import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { generateStructuredOutput } from "@/lib/ai/orchestrator";
import { newBlockId, type CmsBlock } from "@/lib/cms";

/**
 * POST /api/cms/ai-block
 * Body: { prompt: string, pageTitle?: string }
 *
 * Turns a plain-language request ("a contact form that emails us", "an
 * interactive map of our location", "a YouTube embedder", "an Instagram
 * gallery embedder") into a SAFE, structured block. The AI produces only
 * CONFIG — rendering goes through the allowlisted renderers in lib/cms.ts,
 * never raw HTML from the model.
 */
export async function POST(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    const body = (await request.json().catch(() => ({}))) as {
      prompt?: string;
      pageTitle?: string;
    };
    const prompt = body.prompt?.trim();
    if (!prompt) {
      return NextResponse.json({ error: "Describe the block you want to build." }, { status: 400 });
    }
    if (prompt.length > 2000) {
      return NextResponse.json({ error: "Request too long (max 2000 chars)." }, { status: 400 });
    }

    const output = await generateStructuredOutput<{
      widget: "form" | "map" | "youtube" | "instagram" | "embed" | "note";
      title: string;
      config: Record<string, unknown>;
    }>(
      "team_chat",
      `You build website blocks for a visual page builder. Return JSON with:
- "widget": one of "form" | "map" | "youtube" | "instagram" | "embed" | "note"
- "title": short human label for the block
- "config": an object whose shape matches the widget:
  * form       → { fields: string[] (2-5 field names like "name","email","message"), buttonText: string }
  * map        → { query: string (location to show on Google Maps) }
  * youtube    → { url: string (https://www.youtube.com/watch?v=... or youtu.be/...) }
  * instagram  → { url: string (https://www.instagram.com/p/...) }
  * embed      → { src: string (https:// URL to iframe), title: string }
  * note       → { content: string (a short text summary of the block) }

Rules: if the user's request CONTAINS a URL (e.g. "embed this YouTube video
https://www.youtube.com/watch?v=..."), put that exact URL in config — the block
should work immediately. Never invent a URL that isn't in the request — if none
is given, put an empty string and the builder will ask them to fill it in.
config must be plain JSON. No HTML, no scripts, no markdown inside config.`,
      `The user wants one block for a page builder.

Request: "${prompt}"
Page context: ${body.pageTitle ?? "(none)"}

Build exactly one block. Respond only with the JSON object.`,
      tenantId,
      {
        type: "object",
        properties: {
          widget: { type: "string", enum: ["form", "map", "youtube", "instagram", "embed", "note"] },
          title: { type: "string" },
          config: { type: "object" },
        },
        required: ["widget", "title", "config"],
      },
      { temperature: 0.3, maxTokens: 800 }
    );

    // Coerce widget to the known set, default to note.
    const allowed = ["form", "map", "youtube", "instagram", "embed", "note"] as const;
    const widget = allowed.includes((output.widget ?? "note") as (typeof allowed)[number])
      ? (output.widget as CmsBlock["custom"])
      : "note";

    const block: CmsBlock = {
      id: newBlockId(),
      kind: "custom",
      custom: widget,
      content: output.title ?? "AI block",
      config: output.config ?? {},
    };

    return NextResponse.json({ block });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal error";
    console.error("[cms/ai-block]", message);
    return NextResponse.json(
      { error: message.includes("no provider") || message.includes("API key") ? "No AI provider key configured for this task." : message },
      { status: 500 }
    );
  }
}
