// Probe: does a 16384-token budget fix the DeepSeek thinking-mode empty
// response for the campaign-plan schema (which failed at 4096)?
// Mirrors the orchestrator's JSON-mode call. No DB writes.
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Minimal .env.local loader (no dotenv dependency).
for (const line of readFileSync(join(__dirname, "..", ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim();
}

// Inlined copy of the campaign schema from src/lib/ai/team-task.ts (avoiding
// server-only imports).
const CAMPAIGN_PLAN_SCHEMA: any = {
  type: "object",
  properties: {
    title: { type: "string", description: "Short campaign name." },
    summary: { type: "string", description: "2-3 sentence overview." },
    items: {
      type: "array",
      description: "The dated content pieces. 4-8 items total.",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["blog", "social"] },
          topic: { type: "string", description: "The post topic/title." },
          dueDate: { type: "string", description: "YYYY-MM-DD" },
          platform: { type: "string", description: "Social platform for social items, omit for blogs." },
          owner: { type: "string", description: "Employee key who executes this piece." },
        },
        required: ["kind", "topic", "dueDate"],
      },
    },
  },
  required: ["title", "summary", "items"],
};

async function main() {
  const baseUrl = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1";
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    console.error("NO DEEPSEEK_API_KEY");
    process.exit(1);
  }
  const model = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";

  const systemPrompt =
    "You map out dated content campaigns as strict JSON. " +
    "IMPORTANT: You MUST respond with ONLY valid JSON. Do not include any additional text, explanations, or markdown formatting. " +
    "The response must be a single JSON object that can be parsed by JSON.parse(). " +
    "Schema: " + JSON.stringify(CAMPAIGN_PLAN_SCHEMA);
  const userPrompt =
    'Plan the campaign: "2-week Coal Creek seasonal launch — 3 blog posts and 6 social posts with dates, owners, platforms."';

  for (const maxTokens of [16384]) {
    const t0 = Date.now();
    const res = await fetch(baseUrl + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.5,
        max_tokens: maxTokens,
      }),
    });
    const body: any = await res.json();
    const choice = body?.choices?.[0];
    const content: string | undefined = choice?.message?.content;
    const finish = choice?.finish_reason;
    console.log(
      `tokens=${maxTokens} status=${res.status} finish=${finish} contentLen=${(content ?? "").length} elapsed=${((Date.now() - t0) / 1000).toFixed(1)}s`
    );
    if (content) {
      try {
        const parsed = JSON.parse(content);
        const items = Array.isArray(parsed.items) ? parsed.items : [];
        console.log(
          `  PARSED OK title="${parsed.title}" items=${items.length} sample=${JSON.stringify(items[0])?.slice(0, 160)}`
        );
      } catch (e) {
        console.log("  PARSE FAILED:", (content as string).slice(0, 300));
      }
    } else {
      console.log("  EMPTY CONTENT —", JSON.stringify(body?.error ?? body).slice(0, 300));
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
