/**
 * Best-effort client name + website pulled from an onboarding message.
 * A failed parse never blocks onboarding — the caller falls back to
 * "your new client".
 *
 * Kept in a plain (non-"use server") module on purpose: it is a pure sync
 * function, and Next.js forbids synchronous exports from Server Action
 * files. team-task.ts (a "use server" file) imports this helper.
 */
export function extractClientFromMessage(userMessage: string): {
  name: string | null;
  website: string;
} {
  // Primary: an explicit client/company/brand/business mention. Articles and
  // connectors must be followed by whitespace so "a" never swallows the first
  // letter of a capitalized name (e.g. "onboarding Acme Roasters").
  const nameMatch =
    userMessage.match(
      /(?:client|company|brand|business)(?:\s+is|\s+name[d]?s?|\s+for|\s+called|\s+named|\s*[:=])?\s+["']?([A-Z][A-Za-z0-9&'-]*(?:\s+[A-Za-z0-9&'-]+){0,5})/i
    ) ??
    // Fallback: "onboarding <name>" / "bringing on <name>" with no keyword.
    userMessage.match(
      /(?:onboard(?:ing)?|bring(?:ing)?\s+(?:in|on)|tak(?:ing)?\s+(?:on|in))\s+(?:a\s+|an\s+|the\s+)?(?:new\s+client\s+)?["']?([A-Z][A-Za-z0-9&'-]*(?:\s+[A-Za-z0-9&'-]+){0,5})/i
    );
  const website =
    userMessage.match(/https?:\/\/[^\s]+/i)?.[0] ??
    userMessage.match(/\b([a-z0-9-]+\.(?:com|net|org|io|co|dev|site|app|ai))\b/i)?.[0] ??
    "";
  if (!nameMatch) return { name: null, website };
  let name = nameMatch[1].trim();
  // "the company is Acme Roasters at acmeroasters.com" → stop at the domain
  // (the capture class excludes "." so the TLD is cut off — a lone lowercase
  // token after "at" still reads as a domain).
  const atParts = name.split(/\s+at\s+/i);
  if (atParts.length > 1 && /^[a-z0-9-]+(?:\.[a-z]{2,})?$/i.test(atParts[atParts.length - 1].trim())) {
    name = atParts[0];
  }
  // Cut at sentence punctuation, drop leading/trailing connector words.
  name = name.split(/[.!?,;]/)[0].trim();
  name = name
    .replace(/^(?:called|named|is|name|for|at|the|a|an|and|of|with|from|by|on|in|to)\s+/i, "")
    .replace(/\s+(?:at|for|is|and|the|of|with|from|by|on|in|to|a|an)\s*$/i, "")
    .trim();
  const low = name.toLowerCase();
  // A leftover bare domain fragment ("giantbyte" from "at giantbyte.com")
  // is a website, not a name — true when the single-token name also appears
  // as the prefix of a domain in the original message.
  const nameIsDomainFragment =
    !name.includes(" ") &&
    low.length > 2 &&
    new RegExp(`\\b${low.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.[a-z]{2,}\\b`, "i").test(
      userMessage
    );
  if (
    !name ||
    nameIsDomainFragment ||
    low.includes("campaign") ||
    low === "a new client" ||
    low === "new client" ||
    low === "a new client for"
  ) {
    return { name: null, website };
  }
  return { name, website };
}
