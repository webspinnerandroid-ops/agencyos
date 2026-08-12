import { NextRequest, NextResponse } from "next/server";
import { rateLimitRequest } from "@/lib/rate-limit";
import { sendChatMessage } from "@/lib/ai-team-chat";

/**
 * POST /api/ai-team/chat
 *
 * Sends a message to the AI team. Body: { chatId, content }.
 *
 * This route only authenticates, persists the user's message + a "reviewing"
 * status, and enqueues the heavy pipeline (dispatch → employee work → reply)
 * as an Inngest background task (or runs it inline when Inngest is unset). It
 * returns immediately with the inserted messages + taskId; the UI polls the
 * thread and renders each stage (handoff, progress, reply) as it lands.
 */
export async function POST(request: NextRequest) {
  // Rate limit — each send burns LLM tokens (dispatch + reply + possibly
  // a full blog generation with images), so keep it tight.
  const rl = rateLimitRequest(request, "ai-team-chat", 8);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `Rate limit exceeded. Try again in ${rl.retryAfterSeconds}s.` },
      {
        status: 429,
        headers: { "Retry-After": String(rl.retryAfterSeconds) },
      }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { chatId, content } = (body ?? {}) as {
    chatId?: unknown;
    content?: unknown;
  };
  if (typeof chatId !== "string" || typeof content !== "string") {
    return NextResponse.json(
      { error: "chatId and content (strings) are required" },
      { status: 400 }
    );
  }

  const result = await sendChatMessage(chatId, content);
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json({
    success: true,
    taskId: result.data?.taskId ?? null,
    messages: result.data?.messages ?? [],
  });
}
