# Competitive Analysis: tryaeos.com (AEOS) vs Agency OS

**Date:** Aug 2026 · **Category:** AI-Engine-Optimization (AEO/GEO) audit tool vs full agency OS

## What tryaeos.com is

AEOS ("AI Engine Optimization") is a **standalone audit + optimization
dashboard** that scores how visible a website is to AI answer engines
(ChatGPT, Gemini, Claude, Perplexity, Google AI Overviews) alongside
traditional SEO. Its public feature set (from their landing page, Aug 2026):

- **AI Discoverability Audit** — enter a URL, get an instant audit of how
  visible the site is to ChatGPT / Gemini / Claude / Google, with exactly
  what to fix
- **AI Visibility Score (0–100, grade A–F)** — a single number built from
  three sub-scores: **Metadata** (~92%), **Structured data / schema** (~84%),
  **AI readability** (~88%) in their example
- **One-Click AI Optimization** — claims to auto-fix missing meta
  descriptions, missing structured data, and content that isn't "AI-readable"
- **Historical tracking** — visibility over time, improvement after every fix
- **Competitor comparison** — benchmark your site against peers
- **Multi-site monitoring** — dashboard of all monitored sites with
  per-site SEO / AEO / GEO scores and issue counts by severity
- **Pricing** — Free (1 site, 10 AI audits/mo, manual scans, 7-day history),
  Pro $29/mo (5 sites, nightly scans, 90-day history), Max $59/mo
  (15 sites, unlimited API keys, 365-day history)
- **API + webhooks** — 500 API requests/mo free, unlimited on paid tiers

Positioning: a **point tool** for "is my site AI-ready?" It sells audits and
scores. It does **not** generate content, manage social, run campaigns, or
publish anything.

## What Agency OS already has (the overlap)

| tryaeos feature | Agency OS equivalent | Status |
|---|---|---|
| AI Visibility Score (SEO + AEO + GEO) | `scoreContent` (Rank Math-style) + `scoreAeoGeo` heuristic engine — same three pillars, per-content 0–100 scores with checklists | ✅ Built, surfaced on content + analytics SEO tab |
| Structured-data readiness | AEO/GEO engine's "schema readiness" check + extracted Q&A pairs feeding FAQPage/Article schema generation | ✅ Built |
| "Things to fix" issue list | Score checklists (`checks[]` with pass/fail + detail) + the new analytics "Things to fix" panels | ✅ Built |
| Historical progress over time | SEO/AEO/GEO scores stored per post; traffic history in `traffic_snapshots` (90-day sync) | ✅ Built |
| Multi-site monitoring dashboard | Analytics page (per-tenant + per-workspace) with Traffic (GA4 + Search Console) and SEO tabs | ✅ Built |
| Automated re-scans | Daily Inngest traffic sync + score gate on publish (re-scores + auto-rewrites below 80) | ✅ Built |
| Competitor comparison | SEO audit competitor discovery + comparison in audit proposals | Partial — no per-page AEO/GEO competitor benchmark UI |
| One-click fix (metadata/schema) | Not a direct equivalent | **Gap** |
| Public shareable audit links | Public `/seo/proposal` share links | Partial — audits aren't individually shareable |
| API for clients | Platform API + webhooks exist for publishing/analytics; no public "run an audit via API" endpoint | **Gap** |

## What tryaeos has that we don't (and what it would take)

1. **"One-click fix" applied to a live external site.** tryaeos claims to
   auto-apply metadata/schema fixes to your existing site. We don't touch
   third-party sites — and arguably shouldn't. **If we ever want it:**
   the CMS side already generates schema-able content; adding a
   "schema preview + copy JSON-LD" and "meta preview" block per page is a
   small build (est. 1–2 days) and is more honest than a one-click claim.
2. **Public audit share links per site.** We have proposal share links.
   Adding `/audit/[id]` public pages (score dial, checklist, what-to-fix) is
   a straightforward build reusing `scoreContent` + `scoreAeoGeo` —
   **est. 2–3 days** including a white-label option.
3. **AEO/GEO competitor benchmark.** We discover competitors in audits but
   don't score their pages with the same engine. Reusing the engine on
   competitor URLs (crawl → score) is **est. 2–4 days** plus a crawler
   (we can reuse the audit crawler).
4. **Public API to run audits.** Expose the existing audit pipeline via an
   authenticated API route — **est. 1–2 days**.

## What Agency OS has that tryaeos will never have (our moat)

- **We generate the content, then score it** — at generation time, at zero
  marginal cost. tryaeos can only audit what already exists, and its
  "one-click fix" is a claim about *their* stack, not your stack.
- **The 80-point score gate**: content below 80 auto-rewrites before it can
  publish. tryaeos has no content pipeline at all.
- **A 11-person AI team** that plans, writes, images, schedules, and
  publishes — tryaeos scores, full stop.
- **Full agency features**: proposals + Docusign, campaigns + calendar with
  client approval, CMS + website builder, social publishing, lead gen,
  outreach + inbox, billing, per-tenant connections, white-label client
  portals.

## Verdict

**We are not missing tryaeos's core — we are ahead of it.** Every scoring
pillar they sell (SEO / AEO / GEO visibility, issue lists, history) already
exists in our engines and is now surfaced with plain-language insights and
"things to fix" on the Analytics page. The three genuinely useful additions
from their model, in priority order:

1. **Public shareable audit pages** (client-ready "AI Visibility Report") — 2–3 days
2. **AEO/GEO competitor scoring** in audits — 2–4 days
3. **Schema/meta preview + copy** in the CMS — 1–2 days

None are urgent for launch; all reuse engines we already ship.
