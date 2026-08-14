import { NextRequest, NextResponse } from "next/server";
import { getRole, getTenantId } from "@/lib/auth";
import { generateText } from "@/lib/ai/orchestrator";

/**
 * POST /api/admin/page-builder/chat
 *
 * The "builder engineer" chat attached to the visual page builder. A super
 * admin describes a custom piece of the landing page they want built, and the
 * model returns concrete code plus step-by-step deployment instructions.
 *
 * Super admin only. Body: { message: string, history?: {role, content}[] }
 */

const SYSTEM_PROMPT = `You are the platform's senior front-end engineer, embedded in the Agency OS visual page builder. You help the super admin build custom pieces for the public marketing site (Next.js 16 + React + Tailwind, server and client components under src/).

Rules:
- Answer with plain markdown. Put ALL code in fenced code blocks with the language, e.g. \`\`\`tsx ... \`\`\`.
- Always end with a short "## Deploy steps" section: numbered steps that include (1) where the file goes, (2) how to verify it (npm run lint / tsc / build), and (3) how to deploy to the VPS (the project has a deploy script named "node deploy-aifixes.cjs", run from the repo root on the deploy machine — mention it by that name).
- Only emit code that matches this project's existing conventions (Tailwind utility classes, src/ layout, existing components in src/components). Do not invent new dependencies.
- Be concise and copy-pasteable. Prefer the smallest working change.
- If the request is vague or impossible, ask one clarifying question instead of guessing.`;

async function requireSuperAdmin(): Promise<NextResponse | null> {
  try {
    const role = await getRole();
    if (role !== "super_admin") {
      return NextResponse.json(
        { error: "Super admin access required" },
        { status: 403 }
      );
    }
    return null;
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

export async function POST(request: NextRequest) {
  const denied = await requireSuperAdmin();
  if (denied) return denied;

  let body: {
    message?: string;
    history?: { role: "user" | "assistant" | "system"; content: string }[];
  } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  try {
    const tenantId = await getTenantId();

    const history: { role: "user" | "assistant"; content: string }[] = [];
    if (Array.isArray(body.history)) {
      for (const m of body.history.slice(-10)) {
        if (
          m &&
          (m.role === "user" || m.role === "assistant") &&
          typeof m.content === "string" &&
          m.content.trim()
        ) {
          history.push({ role: m.role, content: m.content.trim() });
        }
      }
    }

    const prompt = history
      .map((m) => `${m.role === "user" ? "Admin" : "Engineer"}: ${m.content}`)
      .concat(`Admin: ${message}`)
      .join("\n\n");

    const reply = await generateText("team_chat", prompt, tenantId, {
      systemPrompt: SYSTEM_PROMPT,
      temperature: 0.3,
      maxTokens: 4096,
    });

    return NextResponse.json({ reply });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Chat failed" },
      { status: 500 }
    );
  }
}
