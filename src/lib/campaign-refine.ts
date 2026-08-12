// campaign-refine.ts
//
// "Refine with Malory" — one cheap structured call that polishes an existing
// (usually proposal-seeded) campaign plan: tighter titles, realistic future
// dates starting next week, better spacing, sensible owners. The current plan
// is the input, so the model tightens instead of inventing — no drift from
// what was sold, and the call is far smaller than a from-scratch plan.
import {
  getCampaignPlan,
  updateCampaignPlan,
  type CampaignPlan,
  type CampaignItemKind,
} from "@/lib/campaign-plans";
import { generateStructuredOutput } from "@/lib/ai/orchestrator";
import { buildEmployeeSystemPrompt } from "@/lib/ai/employee-personas";

/** The exact JSON shape the model must return (spelled out in the prompt —
 *  JSON-mode calls never see the tool schema, so we inline it, same as the
 *  blog prompt. Without this the model invents its own field names.) */
const REFINE_SCHEMA_BLOCK = `\\n\\n## CRITICAL OUTPUT INSTRUCTION\\nReturn ONLY valid JSON matching the exact structure below. Do NOT include any markdown formatting, code fences, or explanatory text outside the JSON object. Use EXACTLY these field names — do not rename them, do not add your own fields.\\n\\n{\\n  "title": "string (short campaign name)",\\n  "summary": "string (2-3 sentence overview: goal, audience, arc)",\\n  "items": [\\n    {\\n      "kind": "blog" | "social",\\n      "topic": "string (the post topic/title)",\\n      "dueDate": "string (YYYY-MM-DD)",\\n      "platform": "string (only for social items: instagram | tiktok | facebook | linkedin | x; omit for blogs)",\\n      "owner": "string (employee key: penny for blogs, sonny for socials, gauge for paid, scout for technical, linda for legal, stan for lead-gen)"\\n    }\\n  ]\\n}`;

interface RefinedPlan {
  title: string;
  summary: string;
  items: {
    kind: "blog" | "social";
    topic: string;
    dueDate: string;
    platform?: string;
    owner?: string;
  }[];
}

export interface RefineResult {
  title: string;
  summary: string;
  itemCount: number;
  note: string;
}

/**
 * Ask Malory to polish an existing campaign plan.
 *
 * @param tenantId  tenant scope
 * @param planId    the plan to refine (must belong to the tenant)
 * @returns the refined plan's title/summary/count plus a short note.
 */
export async function refineCampaignPlan(
  tenantId: string,
  planId: string
): Promise<RefineResult> {
  const plan = (await getCampaignPlan(tenantId, planId)) as CampaignPlan | null;
  if (!plan) throw new Error("Campaign plan not found");

  const currentItems = (plan.items ?? []).map((i) => ({
    kind: i.kind,
    topic: i.topic,
    dueDate: i.due_date,
    platform: i.platform ?? undefined,
    owner: i.owner ?? undefined,
  }));

  const systemPrompt =
    buildEmployeeSystemPrompt("nina") +
    "\\n\\nYou are polishing an existing campaign plan. Keep the topics and owners grounded in the plan below — do not invent a different campaign. " +
    "Tighten each title so it is specific and searchable, spread blogs 3-5 days apart with social posts between them, " +
    `and use realistic dates STARTING NEXT WEEK. Today's actual date is ${new Date()
      .toISOString()
      .slice(0, 10)} — every dueDate MUST be on or after that date, never in the past. ` +
    "Keep the same kinds (blog stays blog, social stays social) and sensible owners (penny writes blogs, sonny runs socials)." +
    REFINE_SCHEMA_BLOCK;

  const userPrompt =
    "Current plan: " +
    JSON.stringify({
      title: plan.title,
      summary: plan.summary,
      items: currentItems,
    }) +
    "\\n\\nReturn the polished plan as JSON.";

  const refined = await generateStructuredOutput<RefinedPlan>(
    "team_chat",
    systemPrompt,
    userPrompt,
    tenantId,
    {
      type: "object",
      properties: {
        title: { type: "string" },
        summary: { type: "string" },
        items: { type: "array", items: { type: "object" } },
      },
      required: ["title", "summary", "items"],
    },
    { functionName: "refine_campaign", maxTokens: 16384, temperature: 0.5 }
  );

  const items = Array.isArray(refined.items)
    ? refined.items.filter((i) => i && i.topic && i.dueDate)
    : [];
  if (!refined.title || items.length === 0) {
    throw new Error("Refine came back empty — try again");
  }

  await updateCampaignPlan(tenantId, planId, {
    title: refined.title,
    summary: refined.summary ?? plan.summary,
    items: items.map((i) => ({
      kind: (i.kind === "social" ? "social" : "blog") as CampaignItemKind,
      topic: i.topic,
      dueDate: i.dueDate,
      platform: i.kind === "social" ? (i.platform ?? "instagram") : null,
      owner: i.owner ?? (i.kind === "social" ? "sonny" : "penny"),
    })),
  });

  return {
    title: refined.title,
    summary: refined.summary ?? "",
    itemCount: items.length,
    note: `Malory refined the plan: ${items.length} pieces, retitled and re-dated around the agreed scope.`,
  };
}
