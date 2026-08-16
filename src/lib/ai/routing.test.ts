import { describe, expect, it } from "vitest";
import { routeRequestDeterministically } from "./routing";

/**
 * Every deterministic routing rule, asserted. The chat pipeline runs these
 * BEFORE any model call, so the "who handles this?" question is testable.
 * Cases returning null are genuinely ambiguous → the LLM classifier handles
 * them (covered by the in-flight dispatch tests in the pipeline).
 */
const CASES: {
  request: string;
  expectedKey: string | null;
  expectedAction?: "content" | "campaign" | "onboarding" | "chat";
  expectedReferral?: string | null;
  fixed?: string | null;
}[] = [
  // ---- Client onboarding → Malory (nina), before campaign/content ----
  { request: "I am onboarding a new client for a full campaign, assess their site", expectedKey: "nina", expectedAction: "onboarding" },
  { request: "bring on a new client, they are at giantbyte.com", expectedKey: "nina", expectedAction: "onboarding" },
  { request: "client onboarding for a coffee shop brand", expectedKey: "nina", expectedAction: "onboarding" },
  { request: "start with a new client engagement, get me the campaign going", expectedKey: "nina", expectedAction: "onboarding" },
  // A question about an existing client must NOT trigger onboarding.
  { request: "how is my existing client's campaign going?", expectedKey: null },

  // ---- Content requests → Cheryl (penny) ----
  { request: "write a blog post about espresso machines with images", expectedKey: "penny", expectedAction: "content" },
  { request: "Please create a blog about hotel loyalty programs", expectedKey: "penny", expectedAction: "content" },
  { request: "generate a newsletter for our clients", expectedKey: "penny", expectedAction: "content" },
  { request: "draft a landing page copy for the new SaaS product", expectedKey: "penny", expectedAction: "content" },
  { request: "can you prepare a whitepaper on local SEO?", expectedKey: "penny", expectedAction: "content" },

  // ---- Campaign planning → Malory (nina) ----
  { request: "plan a campaign for the Coal Creek launch with 4 blogs and socials", expectedKey: "nina", expectedAction: "campaign" },
  { request: "map out a content calendar for spring", expectedKey: "nina", expectedAction: "campaign" },
  { request: "create a marketing plan for the new hotel brand", expectedKey: "nina", expectedAction: "campaign" },
  // A question ABOUT an existing plan must NOT trigger campaign planning.
  { request: "what is the status of the campaign plan?", expectedKey: null },
  { request: "check if the campaign is approved", expectedKey: null },

  // ---- Explicit addressing ----
  { request: "Cyril, what indemnification clause should we use?", expectedKey: "linda", expectedAction: "chat" },
  { request: "Cheryl, expand the intro paragraph", expectedKey: "penny", expectedAction: "chat" },
  { request: "Sterling, what's our conversion rate?", expectedKey: "gauge", expectedAction: "chat" },
  { request: "Pam, draft an instagram caption", expectedKey: "sonny", expectedAction: "chat" },
  // Cheryl addressed with a content request runs the REAL blog pipeline.
  { request: "Cheryl, write a blog post about coffee", expectedKey: "penny", expectedAction: "content" },
  // Malory addressed with a campaign request runs the campaign pipeline.
  { request: "Malory, plan a campaign for summer", expectedKey: "nina", expectedAction: "campaign" },
  { request: "AK, run a page speed check", expectedKey: "scout", expectedAction: "chat" },
  { request: "Woodhouse, schedule a meeting with the client", expectedKey: "eva", expectedAction: "chat" },
  { request: "Ray, deploy the new post to wordpress", expectedKey: "dev", expectedAction: "chat" },
  { request: "Barry, find me 20 new leads", expectedKey: "stan", expectedAction: "chat" },
  { request: "Lana, draft a response to this bad review", expectedKey: "juno", expectedAction: "chat" },
  { request: "Brett, book a call for tomorrow", expectedKey: "rachel", expectedAction: "chat" },
  { request: "Malory, what's on the roadmap?", expectedKey: "nina", expectedAction: "chat" },
  { request: "ask Cheryl to look at the draft", expectedKey: "penny", expectedAction: "chat" },

  // ---- Domain routing (the Brett bug regression) ----
  { request: "How about any performance marketing what can we do there?", expectedKey: "gauge", expectedAction: "chat" },
  { request: "what does our ROI look like on paid ads?", expectedKey: "gauge", expectedAction: "chat" },
  { request: "we need help with reputation damage control", expectedKey: "juno", expectedAction: "chat" },
  { request: "someone left a 1-star review, what do we do?", expectedKey: "juno", expectedAction: "chat" },
  { request: "do we need a liability disclaimer for allergens on the site?", expectedKey: "linda", expectedAction: "chat" },
  { request: "post about our new launch on instagram", expectedKey: "sonny", expectedAction: "chat" },
  { request: "create a tiktok trend video for the brand", expectedKey: "sonny", expectedAction: "chat" },
  { request: "generate 50 leads from apollo", expectedKey: "stan", expectedAction: "chat" },
  { request: "set up outbound follow-up sequences", expectedKey: "stan", expectedAction: "chat" },
  { request: "publish the new article to wordpress", expectedKey: "dev", expectedAction: "chat" },
  { request: "our site has broken code on the checkout page", expectedKey: "dev", expectedAction: "chat" },
  { request: "check our core web vitals", expectedKey: "scout", expectedAction: "chat" },
  { request: "the sitemap has wrong canonicals", expectedKey: "scout", expectedAction: "chat" },
  { request: "schedule a meeting for tomorrow", expectedKey: "eva", expectedAction: "chat" },
  { request: "triage my inbox please", expectedKey: "eva", expectedAction: "chat" },

  // ---- Fixed employee (DM) ----
  // A DM is answered BY that employee. Their own pipeline still fires
  // (Cheryl writes, Malory plans); anything out of their lane is answered
  // with a referral to the specialist.
  { request: "write a blog post about coffee", fixed: "linda", expectedKey: "linda", expectedAction: "chat", expectedReferral: "penny" },
  { request: "write a blog post about coffee", fixed: "stan", expectedKey: "stan", expectedAction: "chat", expectedReferral: "penny" },
  { request: "plan a campaign for summer", fixed: "stan", expectedKey: "stan", expectedAction: "chat", expectedReferral: "nina" },
  { request: "someone left a 1-star review", fixed: "stan", expectedKey: "stan", expectedAction: "chat", expectedReferral: "juno" },
  { request: "draft a liability disclaimer", fixed: "gauge", expectedKey: "gauge", expectedAction: "chat", expectedReferral: "linda" },
  // The writer's own DM still runs the real content pipeline.
  { request: "write a blog post about coffee", fixed: "penny", expectedKey: "penny", expectedAction: "content" },
  // Malory's own DM still runs the campaign pipeline.
  { request: "plan a campaign for summer", fixed: "nina", expectedKey: "nina", expectedAction: "campaign" },
  // In their own lane → no referral.
  { request: "find me 20 new leads", fixed: "stan", expectedKey: "stan", expectedAction: "chat" },
  // In a Sterling DM the fixed employee is applied by the LLM fallback when
  // no deterministic rule matches (returns null here — not the classifier).
  { request: "what can you do?", fixed: "gauge", expectedKey: null },

  // ---- Genuinely ambiguous → LLM classifier ----
  { request: "hello, what can you do?", expectedKey: null },
  { request: "good morning", expectedKey: null },
  { request: "can you help me with something?", expectedKey: null },
];

describe("routeRequestDeterministically", () => {
  it.each(CASES)("routes: $request", ({ request, expectedKey, expectedAction, expectedReferral, fixed }) => {
    const decision = routeRequestDeterministically(request, fixed ?? null);
    if (expectedKey === null) {
      expect(decision).toBeNull();
      return;
    }
    expect(decision).not.toBeNull();
    expect(decision!.employeeKey).toBe(expectedKey);
    if (expectedAction) expect(decision!.action).toBe(expectedAction);
    if (expectedReferral !== undefined) {
      expect(decision!.referralKey).toBe(expectedReferral);
    }
  });

  it("never routes to an unknown employee key", () => {
    for (const c of CASES) {
      const d = routeRequestDeterministically(c.request, c.fixed ?? null);
      if (d) {
        expect([
          "penny", "eva", "sonny", "stan", "rachel", "scout",
          "dev", "gauge", "nina", "juno", "linda",
        ]).toContain(d.employeeKey);
      }
    }
  });
});
