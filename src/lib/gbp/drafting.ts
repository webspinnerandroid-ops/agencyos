// ============================================================================
// Lana's review-reply drafter — shared by the dashboard action and the hourly
// sync worker. Pure AI + prompt logic (no request context, no DB client of
// its own — callers pass one), so it runs anywhere with a tenantId.
// ============================================================================

import { generateStructuredOutput } from "@/lib/ai/orchestrator";
import type { ServiceClient } from "@/lib/gbp/client";

export interface GbpReplyDraft {
  /** The ready-to-post public response (plain text). */
  response: string;
  /** One-line note on the tone used and why. */
  tone: string;
  /** PR/legal risks a human should eyeball before posting. */
  redFlags: string[];
  /** True when Lana recommends a human sign-off before posting. */
  escalate: boolean;
}

const STAR_WORDS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

export const starNumber = (word: string): number => STAR_WORDS[word] ?? 0;

const LANA_SYSTEM_PROMPT = `You are Lana, the agency's reputation manager — a senior crisis-communications
professional drafting a PUBLIC reply to a Google review. Rules:
- Never admit liability or fault in a public post; acknowledge the experience instead.
- Never argue with the customer, even if the review is unfair or factually wrong.
- Always offer a private follow-up path (email/phone) for resolving specifics.
- Keep it concise — well under 200 words, plain text, no emoji walls, no marketing fluff.
- Match the brand's voice; thank positive reviewers specifically (no generic thanks).
- 1-2 star reviews: empathize, take ownership of the experience, move details offline.
Return JSON: { "response": string, "tone": string, "redFlags": string[], "escalate": boolean }.
"response" is the exact ready-to-post public reply. "tone" is one line on the tone used.
"redFlags" lists anything a human must check before posting (empty array if none).
"escalate" is true when you'd want a human sign-off first (legal threats, discrimination
claims, refund demands, doxxing...).`;

const REPLY_SCHEMA = {
  type: "object",
  properties: {
    response: { type: "string" },
    tone: { type: "string" },
    redFlags: { type: "array", items: { type: "string" } },
    escalate: { type: "boolean" },
  },
  required: ["response", "tone", "redFlags", "escalate"],
} as const;

/**
 * Brand voice from the workspace's brand profile, when one exists. Tenant and
 * workspace are explicit (worker-safe) and always scoped in the query.
 */
export async function fetchBrandContext(
  supabase: ServiceClient,
  tenantId: string,
  workspaceId: string | null
): Promise<string> {
  if (!workspaceId) return "";
  try {
    const { data: brand } = await supabase
      .from("brand_profiles")
      .select("brand_voice, tone_of_voice, avoid_words")
      .eq("tenant_id", tenantId)
      .eq("workspace_id", workspaceId)
      .limit(1)
      .maybeSingle();
    if (!brand) return "";
    return [
      brand.brand_voice ? `Brand voice: ${brand.brand_voice}` : "",
      brand.tone_of_voice ? `Tone of voice: ${brand.tone_of_voice}` : "",
      Array.isArray(brand.avoid_words) && brand.avoid_words.length > 0
        ? `Never use these words: ${brand.avoid_words.join(", ")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");
  } catch {
    return "";
  }
}

export interface DraftReplyInput {
  businessName: string;
  starRatingWord: string;
  reviewerName: string | null;
  comment: string | null;
  brandContext?: string;
}

/**
 * Draft a public Google review reply with Lana's rules (see the prompt).
 * Returns only the draft — persisting/posting is the caller's job.
 */
export async function draftReviewReply(
  tenantId: string,
  input: DraftReplyInput
): Promise<GbpReplyDraft> {
  const stars = starNumber(input.starRatingWord);
  return generateStructuredOutput<GbpReplyDraft>(
    "team_chat",
    LANA_SYSTEM_PROMPT,
    `Business: ${input.businessName}
Review rating: ${stars} out of 5 stars
Reviewer name: ${input.reviewerName ?? "A Google user"}
Review text:
${input.comment ?? "(no text — rating only)"}${
      input.brandContext ? `\n\nBrand context:\n${input.brandContext}` : ""
    }`,
    tenantId,
    REPLY_SCHEMA,
    {
      functionName: "gbp_review_reply_draft",
      temperature: 0.5,
      maxTokens: 800,
    }
  );
}
