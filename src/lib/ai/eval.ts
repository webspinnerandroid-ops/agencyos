/**
 * AI Team — eval loop.
 *
 * The "better is measurable" piece: each employee has a small set of quality
 * criteria (with good/bad examples) their outputs are checked against. The
 * same engine that scores content (rankmath) has its analogue here for the
 * team's deliverables — so when a persona or pipeline changes, we can show
 * the score moving instead of relying on vibes.
 *
 * `scoreEmployeeOutput` runs text/JSON outputs through the criteria for a
 * role and returns per-criterion pass/fail plus an overall score. The
 * criteria encode the persona's own output contract (see
 * src/lib/ai/employee-personas.ts) in checkable form.
 */

import { EMPLOYEE_PERSONAS } from "@/lib/ai/employee-personas";

export interface EvalCriterion {
  name: string;
  /** Explanation of what "good" looks like (mirrors the persona's rules). */
  what: string;
  /** Passes when this returns true. */
  check: (output: string, opts: Record<string, unknown>) => boolean;
}

export interface EvalResult {
  employeeKey: string;
  employeeName: string;
  score: number; // 0..1
  passed: number;
  total: number;
  verdict: "pass" | "review" | "fail";
  criteria: { name: string; what: string; passed: boolean }[];
}

/** Strip markdown/HTML so plain-text checks don't trip on formatting. */
function plain(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[#>*_`[\]()|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function has(text: string, needle: string): boolean {
  return plain(text).includes(needle.toLowerCase());
}

function countWords(text: string): number {
  return plain(text).split(/\s+/).filter(Boolean).length;
}

// ---------------------------------------------------------------------------
// Per-role criteria. Each check is a pure function of the output text plus
// optional context (e.g. { keyword }) so tests can exercise them directly.
// ---------------------------------------------------------------------------

const CRITERIA: Record<string, EvalCriterion[]> = {
  // Cheryl — SEO Content Writer
  penny: [
    {
      name: "Has a title",
      what: "Every post has a working title.",
      check: (o) => has(o, "title") || /^#\s+.+/.test(o),
    },
    {
      name: "No JSON leak",
      what: "The body must never be a raw JSON blob or placeholder object.",
      check: (o) =>
        !/\{\s*"(body|title|type)"/.test(o) &&
        !/^\s*\{[\s\S]*"body"\s*:\s*""/.test(o),
    },
    {
      name: "Substantial body",
      what: "A publishable post is at least ~600 words.",
      check: (o) => countWords(o) >= 600,
    },
    {
      name: "Keyword in first 10%",
      what: "The focus keyword appears early in the body.",
      check: (o, ctx) => {
        const kw = String(ctx.keyword ?? "");
        if (!kw) return true; // no keyword supplied — skip
        const clean = plain(o);
        const head = clean.slice(0, Math.max(200, Math.floor(clean.length * 0.1)));
        return head.includes(kw.toLowerCase());
      },
    },
    {
      name: "Headings present",
      what: "H2/H3 structure — scannable, question-answering sections.",
      check: (o) => /(^|\n)#{2,3}\s+.+/.test(o) || o.includes("\n## ") || o.includes("\n### "),
    },
    {
      name: "No invented statistics",
      what: "No unlabeled numbers presented as research facts (e.g. 'boosts rankings by 300%').",
      check: (o) => !/(increases?|boosts?|improves?|raises?)[^.]{0,60}\d{2,}%/.test(plain(o)),
    },
    {
      name: "Internal links when pages exist",
      what: "Blogs link to the client's own pages when the workspace has any.",
      check: (o, ctx) => {
        const pages = (ctx.internalUrls ?? []) as string[];
        if (pages.length === 0) return true;
        return /(site\/|href=|\(\[|\]\(|\bhttps?:\/\/)/.test(o) || has(o, pages[0] ?? "");
      },
    },
  ],

  // Woodhouse — Executive Assistant
  eva: [
    {
      name: "Actionable summary",
      what: "Replies triage into action items, not message dumps.",
      check: (o) => /(\baction\b|\bnext steps?\b|\btodo\b|\bdo\b)/i.test(o),
    },
    {
      name: "Time zone discipline",
      what: "Scheduling always states a time zone.",
      check: (o, ctx) => {
        if (!/schedul|meeting|call|book|time/i.test(o)) return true;
        return /(am|pm|utc|est|pst|gmt|ct|et)/i.test(o);
      },
    },
    {
      name: "Drafts, not sends",
      what: "Email replies are drafts awaiting approval, never auto-sent claims.",
      check: (o) => !/sent (the )?email|emailed (the|them)|i sent/i.test(o),
    },
  ],

  // Pam — Social Media Manager
  sonny: [
    {
      name: "Hook first",
      what: "The first line is a hook, not a throat-clearing intro.",
      check: (o) => {
        const first = plain(o).split(/\s+/).slice(0, 12).join(" ");
        return !/^(hi|hello|hey|welcome|thanks for|so,|well,)/.test(first);
      },
    },
    {
      name: "One clear CTA",
      what: "Every post has a single call to action.",
      check: (o) => /(follow|comment|share|save|click|link in bio|sign up|book|dm|visit|check out)/i.test(o),
    },
    {
      name: "Platform length",
      what: "Captions fit the platform (short for X/Threads, longer for IG/FB/LinkedIn).",
      check: (o, ctx) => {
        const platform = String(ctx.platform ?? "instagram");
        if (platform === "x" || platform === "threads") return countWords(o) <= 60;
        return true;
      },
    },
    {
      name: "No engagement bait",
      what: "No 'like this or unfollow' style manipulation platforms penalize.",
      check: (o) => !/(like (this|the post) or|follow or unfollow|comment .*to win|tag .*to enter)/i.test(o),
    },
  ],

  // Barry — Lead Generation
  stan: [
    {
      name: "Personalized opening",
      what: "Outreach references something specific about the prospect.",
      check: (o) => !/^(dear sir|to whom it may concern|hello there,?\s*$)/i.test(plain(o)),
    },
    {
      name: "One CTA",
      what: "A single, trivial-to-answer call to action.",
      check: (o) => /(reply (yes|no)|book|call|schedule|want me to|open to)/i.test(o),
    },
    {
      name: "Compliance-aware",
      what: "Opt-out honored; no spammy urgency or false scarcity.",
      check: (o) => !/(act now|only \d+ (spots|left)|limited time|urgent!!)/i.test(o),
    },
  ],

  // Brett — Receptionist
  rachel: [
    {
      name: "No phone script in chat",
      what: "In a chat conversation, never open with the phone greeting.",
      check: (o) => !/(you've reached|you have reached|thanks for (calling|reaching out)|thank you for contacting)/i.test(o),
    },
    {
      name: "Answers the question",
      what: "Direct, useful response — not a deflection.",
      check: (o) => countWords(o) > 10 || /(yes|no|here|this is|you can|we can)/i.test(o),
    },
  ],

  // AK — Technical SEO Auditor
  scout: [
    {
      name: "Severity + evidence",
      what: "Findings carry severity and evidence, not just opinions.",
      check: (o) => /(severity|critical|high|medium|low|impact)/i.test(o) && /(url|https?:\/\/|example|evidence|observed)/i.test(o),
    },
    {
      name: "No invented metrics",
      what: "Never report a score/metric that wasn't measured.",
      check: (o) => !/(ranked? #\d|da \d+|dr \d+|authority score \d+)/i.test(o) || /(estimated|estimate|suspected)/i.test(o),
    },
  ],

  // Ray — Web Developer
  dev: [
    {
      name: "Failure honesty",
      what: "Failures are reported with the platform response, never silently dropped.",
      check: (o) => !/(went fine|no problems)/i.test(o) || /(error|failed|status)/i.test(o),
    },
    {
      name: "No credential leakage",
      what: "Never include tokens, passwords, or API keys in output.",
      check: (o) => !/(sk-|key[=: ]|password[=: ]|token[=: ]|secret[=: ])/i.test(o),
    },
  ],

  // Sterling — Performance Marketer
  gauge: [
    {
      name: "Real numbers or honest gaps",
      what: "Metrics come from data; when there's none, say so.",
      check: (o) => /\d+%|\d+(\.\d+)?\s*(clicks|impressions|sessions|users|conversions)/.test(o) || /(insufficient|no data|not available|can't|don't have)/i.test(o),
    },
    {
      name: "No AI-estimate as fact",
      what: "Estimated performance is labeled as an estimate.",
      check: (o) => !/(estimated|projected|predicted|likely)/i.test(o) || /(estimate|projection|prediction)/i.test(o),
    },
  ],

  // Malory — Project Manager
  nina: [
    {
      name: "Dated, ordered plan",
      what: "Every item carries a date and the plan reads top-to-bottom.",
      check: (o) => /\d{4}-\d{2}-\d{2}/.test(o) || /(step|phase|day \d|week \d)/i.test(o),
    },
    {
      name: "Owners assigned",
      what: "Each piece has a named owner.",
      check: (o) => /(cheryl|pam|malory|sterling|ak|ray|lana|cyril|barry|woodhouse|brett|penny|sonny|nina)/i.test(o),
    },
    {
      name: "No past dates",
      what: "Plans schedule forward — nothing dated in the past.",
      check: (o, ctx) => {
        const today = String(ctx.today ?? new Date().toISOString().slice(0, 10));
        const dates = o.match(/\d{4}-\d{2}-\d{2}/g) ?? [];
        return dates.every((d) => d >= today);
      },
    },
  ],

  // Lana — Reputation Manager
  juno: [
    {
      name: "Concise response",
      what: "Public responses stay under ~200 words.",
      check: (o) => countWords(o) <= 240,
    },
    {
      name: "No public liability admission",
      what: "Never admit fault or liability in a public post.",
      check: (o) => !/(we are (at )?fault|we accept (full )?liability|our fault|we were wrong to)/i.test(o),
    },
    {
      name: "Private follow-up path",
      what: "Always offers a way to continue privately.",
      check: (o) => /(dm|email|private|message|direct|phone|book)/i.test(o),
    },
    {
      name: "No public argument",
      what: "De-escalates in public — no arguing with the customer.",
      check: (o) => !/(you are wrong|you're wrong|that's not true|you misunderstood)/i.test(o),
    },
  ],

  // Cyril — Legal Assistant
  linda: [
    {
      name: "Plain-language drafting",
      what: "Contracts read clearly — no impenetrable legalese wall.",
      check: (o) => countWords(o) > 0 && !/whereas the party of the first part/i.test(o),
    },
    {
      name: "Governing law line",
      what: "Documents carry a jurisdiction/governing-law clause.",
      check: (o) => /(governing law|jurisdiction|province|state of|law of)/i.test(o),
    },
    {
      name: "Cancellation clause",
      what: "Termination/cancellation terms are present (60-day default).",
      check: (o) => /(cancel|terminat|notice period|60-?day)/i.test(o),
    },
    {
      name: "Lawyer-review disclaimer",
      what: "Never presents itself as final legal advice.",
      check: (o) => /(not legal advice|lawyer|attorney|qualified)/i.test(o),
    },
    {
      name: "Placeholders, not invented parties",
      what: "Unknown parties use placeholders like [Client].",
      check: (o) => /(\[client\]|\[agency\]|\[company\]|\[name\])/i.test(o),
    },
  ],
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** All roles that have eval criteria (a superset of the persona catalog). */
export const EVAL_ROLES = Object.keys(CRITERIA);

/** Run every criterion for an employee against an output. */
export function scoreEmployeeOutput(
  employeeKey: string,
  output: string,
  opts: Record<string, unknown> = {}
): EvalResult {
  const criteria = CRITERIA[employeeKey] ?? [];
  const persona = EMPLOYEE_PERSONAS[employeeKey as keyof typeof EMPLOYEE_PERSONAS];
  const results = criteria.map((c) => {
    let passed = false;
    try {
      passed = c.check(output, opts);
    } catch {
      passed = false;
    }
    return { name: c.name, what: c.what, passed };
  });
  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  const score = total > 0 ? passed / total : 0;
  return {
    employeeKey,
    employeeName: persona?.name ?? employeeKey,
    score,
    passed,
    total,
    verdict: score >= 0.8 ? "pass" : score >= 0.5 ? "review" : "fail",
    criteria: results,
  };
}

/** Run the whole team against a mapping of employeeKey → output. */
export function evalTeam(
  outputs: Record<string, string>,
  opts: Record<string, unknown> = {}
): Record<string, EvalResult> {
  const results: Record<string, EvalResult> = {};
  for (const key of Object.keys(outputs)) {
    results[key] = scoreEmployeeOutput(key, outputs[key], opts);
  }
  return results;
}

// ---------------------------------------------------------------------------
// Good / bad sample sets per role — the calibration data that makes "better"
// measurable. Tests assert good samples pass and bad samples fail, so a
// persona change that loosens quality breaks the suite.
// ---------------------------------------------------------------------------

export const EVAL_SAMPLES: Record<
  string,
  { good: string; bad: string }
> = {
  penny: {
    good:
      "# Why Can't We Be Friends? The Honest Truth About Adult Friendships\n\n" +
      "Adult friendships are hard, and the reasons are simpler than you think. This guide covers " +
      "why adult friendship gets harder, what the research says, and practical steps to fix it. " +
      "If you've ever wondered why close friends drift apart, this is for you.\n\n" +
      "## Why friendship changes after 30\n" +
      "Life gets busy. Careers, partners, and kids crowd the calendar, and the weekly hangouts that " +
      "once held a friendship together quietly disappear. The friendship isn't over — it's just " +
      "unmaintained. Most people assume a good friendship survives on its own, and that assumption " +
      "is exactly what kills it.\n\n" +
      "## The research behind the drift\n" +
      "Social scientists who study close relationships consistently find that proximity and shared " +
      "context drive friendship maintenance far more than personality. When you stop sharing an " +
      "environment, the friendship needs a deliberate replacement: scheduled calls, shared hobbies, " +
      "or trips. Without one, contact decays naturally. That is not a personality flaw — it is a " +
      "design problem, and design problems have design fixes.\n\n" +
      "## What the song actually got right\n" +
      "The question behind the classic song is not silly at all. It asks why two people who were " +
      "close can suddenly be strangers, and the honest answer is: nobody maintained the bridge. " +
      "The song is funny because it is painfully accurate, and that accuracy is why it stuck.\n\n" +
      "## How to actually stay close\n" +
      "Here are the steps that work, in order of impact.\n\n" +
      "### 1. Schedule the next thing before you leave\n" +
      "Never end a catch-up without a date for the next one. A vague \"let's do this again\" is a " +
      "polite goodbye, not a plan. Even a date three months out keeps the friendship on the books.\n\n" +
      "### 2. Make it low-friction\n" +
      "The best friendships have the lowest booking cost. A standing walk, a shared hobby, or a " +
      "weekly call beats a quarterly dinner that requires three rounds of scheduling.\n\n" +
      "### 3. Talk about the friendship itself\n" +
      "Once a year, say the quiet part out loud: this friendship matters to me, and I want to keep " +
      "investing in it. It feels awkward for ten seconds and changes the relationship for years.\n\n" +
      "### 4. Accept the seasons\n" +
      "Some friendships are for a season, and that is okay. The goal is not to keep every person " +
      "forever — it is to keep the ones who make you better, and to let the rest go kindly.\n\n" +
      "## When to let it go\n" +
      "Not every friendship should be saved. If the relationship is one-sided, draining, or built " +
      "on guilt, the kindest move is a graceful, honest fade. Protecting your energy is part of " +
      "maintaining the friendships that genuinely matter.\n\n" +
      "## The bottom line\n" +
      "Adult friendships fail by neglect far more often than by conflict. The fix is boring and " +
      "effective: schedule it, lower the friction, and say it out loud. Start with one friend this " +
      "week and see what happens.\n\n" +
      "You might also like: [How to stay close with old friends](/site/friendship-guide)",
    bad:
      '{"body": "", "type": "blog", "title": "Friendship post"}',
  },
  sonny: {
    good:
      "Still using the same caption on every platform? That's the #1 way to waste your reach.\n\n" +
      "Here's a 3-line cheat sheet per network. Save this one.\n\n" +
      "Follow for more content that actually performs.",
    bad:
      "Hello everyone! Welcome to our page. We are very happy to share this content with you all today. Please like this post or unfollow. Thank you!",
  },
  nina: {
    good:
      "Plan: Fall launch awareness\n" +
      "1. 2026-08-25 — Cheryl: launch blog post\n" +
      "2. 2026-08-27 — Pam: Instagram teaser\n" +
      "3. 2026-08-29 — Cheryl: FAQ blog",
    bad:
      "2026-01-01 — old plan, no owners, no structure at all really.",
  },
  linda: {
    good:
      "## Service Agreement between [Client] and [Agency]\n\n" +
      "1. Services. Agency will provide...\n" +
      "2. Term & Cancellation. Either party may cancel with 60 days written notice.\n" +
      "3. Governing Law. This agreement is governed by the laws of the Province of Ontario.\n\n" +
      "_This is a drafting aid, not legal advice. A qualified lawyer must review before signature._",
    bad:
      "Here is your contract. It is totally fine, you can sign it. Trust me.",
  },
  juno: {
    good:
      "Thanks for flagging this — we hear you and we're sorry the experience fell short.\n" +
      "Please DM us your order number so we can make it right privately.",
    bad:
      "You are wrong about this and we are not at fault. We accept no liability whatsoever. You clearly misunderstood.",
  },
  rachel: {
    good:
      "You can publish to the calendar and it schedules automatically — here's exactly how...",
    bad:
      "Hi there — thanks for reaching out! You've reached the front desk. How can I help you today?",
  },
};
