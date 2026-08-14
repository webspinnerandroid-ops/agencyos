// ============================================================================
// Deterministic AI-team routing — pure functions, NO server imports, no model
// calls. The chat pipeline (team-task.ts) uses these as the first pass before
// the LLM classifier; the test suite asserts every rule so "who handles
// this?" is verifiable.
// ============================================================================

import { EMPLOYEE_KEYS } from "@/lib/ai/employee-keys";

export interface DispatchDecision {
  employeeKey: string;
  action: "content" | "campaign" | "chat" | "other";
  topic: string;
  note: string;
  /** When a DM employee is asked something outside their lane, the key of
   * the specialist who should really handle it — so the selected employee can
   * suggest messaging them or pulling them into the chat. */
  referralKey?: string;
}

/**
 * Explicit content requests (write/create a blog post, article, content)
 * always route to Cheryl (penny) without burning a model call.
 */
export const CONTENT_REQUEST_RE =
  /\b(write|create|generate|draft|produce|compose|make|prepare|start)\b[^\n]{0,60}\b(blog|article|post|content|piece|guide|whitepaper|newsletter|landing\s+page|email|copy|caption|script)\b/i;

/**
 * Requests to PLAN a campaign (the whole 0→100 mapped out with dated blogs +
 * socials) always route to Malory (nina), who produces the structured plan
 * saved to the calendar.
 */
export const CAMPAIGN_REQUEST_RE =
  /\b(plan|map out|map|build|outline|create|draft)\b[^\n]{0,60}\b(campaign|content calendar|editorial calendar|content plan|marketing plan)\b/i;

/** Pull a usable topic out of a content request ("write a blog about X" → X). */
export function topicFromRequest(request: string): string {
  const stripped = request
    .replace(
      /^(please\s+)?(write|create|generate|draft|produce|compose|make|prepare|start)\s+(me\s+)?(a|an|some|the)?\s*(blog\s+)?(post|article|piece|content|guide|whitepaper|newsletter)?\s*(about|on|for|regarding|covering)\s*/i,
      ""
    )
    .replace(/[.!?]+\s*$/g, "")
    .trim();
  return stripped || request;
}

/** Persona display names → employee keys, for explicit addressing. */
export const PERSONA_NAME_TO_KEY: Record<string, string> = {
  cheryl: "penny",
  woodhouse: "eva",
  pam: "sonny",
  barry: "stan",
  brett: "rachel",
  ak: "scout",
  ray: "dev",
  sterling: "gauge",
  malory: "nina",
  lana: "juno",
  cyril: "linda",
};

/** Deterministic: does the message explicitly address one employee? */
export function addressedEmployee(request: string): string | null {
  const norm = request
    .toLowerCase()
    .replace(/[@!.,;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = norm.split(" ").filter(Boolean);
  const first = words[0] ?? "";
  if (PERSONA_NAME_TO_KEY[first]) return PERSONA_NAME_TO_KEY[first];
  if (first === "ask" && words[1] && PERSONA_NAME_TO_KEY[words[1]]) {
    return PERSONA_NAME_TO_KEY[words[1]];
  }
  return null;
}

/**
 * Domain keywords route straight to the right specialist with no model call
 * — the LLM classifier alone proved unreliable (a performance-marketing
 * question went to Brett the receptionist). Specific domains first.
 */
export const DOMAIN_ROUTES: { re: RegExp; employeeKey: string }[] = [
  { re: /\b(reputation|reviews?|damage control|crisis|complaint|bad press|brand mentions?)\b/i, employeeKey: "juno" },
  { re: /\b(legal|lawyer|contract|agreement|nda|liability|disclaimer|compliance|terms of (service|use)|privacy policy|trademark|copyright|jurisdiction|allergen)\b/i, employeeKey: "linda" },
  { re: /\b(performance marketing|roi|conversion|ads?|paid (media|social|search)|analytics|engagement rate|ctr|attribution|campaign performance|ad spend)\b/i, employeeKey: "gauge" },
  { re: /\b(instagram|tiktok|facebook|linkedin|threads|youtube|pinterest|social media|hashtags?|captions?|reels?|stories?|community management)\b/i, employeeKey: "sonny" },
  { re: /\b(lead(s|gen)?|prospects?|outbound|outreach|apollo|icp|sales funnel|follow[- ]?up sequence|cold email)\b/i, employeeKey: "stan" },
  { re: /\b(wordpress|joomla|cms|webflow|website build|develop|code|integration|api|plugin|theme|deploy)\b/i, employeeKey: "dev" },
  { re: /\b(core web vitals|page ?speed|crawl|indexation|sitemap|schema|redirect|canonical|hreflang|technical seo)\b/i, employeeKey: "scout" },
  { re: /\b(meeting|schedule|calendar|inbox|email draft|appointment|booking|travel|time zone)\b/i, employeeKey: "eva" },
  { re: /\b(front desk|phone call|caller|reception|inbound call)\b/i, employeeKey: "rachel" },
];

/**
 * The natural route for a message — who would handle it in the Team Room,
 * with no fixed-employee override. Pure: no model calls.
 */
function naturalRoute(request: string): DispatchDecision | null {
  // Explicitly addressed to one employee → route to them, no model call.
  // The address chooses WHO answers; the action stays chat unless the
  // addressed employee is the one whose pipeline the request maps to
  // (Malory plans campaigns, Cheryl writes content) — so "Pam, draft a
  // caption" goes to Pam as chat, while "Cheryl, write a blog post" runs
  // Cheryl's real blog pipeline.
  const addressed = addressedEmployee(request);
  if (addressed) {
    if (addressed === "nina" && CAMPAIGN_REQUEST_RE.test(request)) {
      return {
        employeeKey: "nina",
        action: "campaign",
        topic: topicFromRequest(request),
        note: "Campaign planning request detected.",
      };
    }
    if (addressed === "penny" && CONTENT_REQUEST_RE.test(request)) {
      return {
        employeeKey: "penny",
        action: "content",
        topic: topicFromRequest(request),
        note: "Content request detected.",
      };
    }
    return {
      employeeKey: addressed,
      action: "chat",
      topic: "",
      note: "Addressed directly.",
    };
  }

  // Campaign planning request → Malory, no model call needed.
  if (CAMPAIGN_REQUEST_RE.test(request)) {
    return {
      employeeKey: "nina",
      action: "campaign",
      topic: topicFromRequest(request),
      note: "Campaign planning request detected.",
    };
  }

  // Explicit content request → Cheryl, no model call needed.
  if (CONTENT_REQUEST_RE.test(request)) {
    return {
      employeeKey: "penny",
      action: "content",
      topic: topicFromRequest(request),
      note: "Content request detected.",
    };
  }

  for (const route of DOMAIN_ROUTES) {
    if (route.re.test(request)) {
      return {
        employeeKey: route.employeeKey,
        action: "chat",
        topic: "",
        note: "Domain routed.",
      };
    }
  }

  return null;
}

/**
 * Returns a deterministic decision when a rule matches (fixed employee,
 * campaign/content requests, explicit addressing, domain keywords), or null
 * so the caller can fall back to the LLM classifier for ambiguous messages.
 *
 * A fixed employee (a DM chat) ALWAYS answers. The fixed employee's own
 * pipeline still fires (Cheryl writes content, Malory plans campaigns), but
 * an out-of-lane request is answered by the selected employee — with a
 * referralKey pointing at the specialist who should really handle it.
 */
export function routeRequestDeterministically(
  request: string,
  fixedEmployeeKey: string | null
): DispatchDecision | null {
  const forced =
    fixedEmployeeKey &&
    (EMPLOYEE_KEYS as readonly string[]).includes(fixedEmployeeKey)
      ? fixedEmployeeKey
      : null;

  const natural = naturalRoute(request);

  // Team Room / named rooms: the natural route decides.
  if (!forced) return natural;

  // The DM employee is the right person — keep their own pipeline.
  if (natural && natural.employeeKey === forced) return natural;

  // Asked something out of their lane: the selected employee answers and
  // points at the specialist (the caller adds the "message them / bring them
  // into the chat" suggestion to the persona prompt).
  if (natural && natural.employeeKey !== forced) {
    return {
      employeeKey: forced,
      action: "chat",
      topic: "",
      note: "Direct message — answered by the selected employee.",
      referralKey: natural.employeeKey,
    };
  }

  // Ambiguous (no natural route) — fall through to the LLM classifier, which
  // still forces the employee while classifying content/campaign/chat.
  return null;
}
