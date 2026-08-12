# AEO / GEO Scoring Engine — Design

**Status:** Engine built (`src/lib/aeo-geo.ts`, unit-tested); UI surfacing pending.
**Goal:** mirror the tryaeos.com model — every piece of content gets an
**SEO score** (existing Rank Math-style scorer), an **AEO score** (answer-engine
readiness), and a **GEO score** (generative-engine citation readiness), all in
one dashboard the agency can share with clients.

## Why this beats the tryaeos approach for us

tryaeos.com sells a standalone audit dashboard. We already generate the content,
so we can score **at generation time, at zero marginal cost** — no separate
crawl, no per-audit LLM spend. The scorer is pure text analysis (like
`rankmath.ts`), so it runs on every post the moment it's created.

## Scoring pillars (100 points total)

| Pillar | Weight | What it measures |
|---|---|---|
| **AEO — Answer readiness** | 50 | Question-language coverage, explicit `?` questions, extracted Q&A pairs, keyword answered in the first 10%, definitional intro, entity naming |
| **GEO — Citation readiness** | 50 | Data/statistics present, FAQ/Article schema readiness, step/how-to structure, authority signals (studies, citations), outbound reference links |

Each check is a pure pass/fail function (earns full points or 0) — same model as
the Rank Math scorer, so both engines share a consistent mental model.

## What the engine emits

- `total` (0–100), `aeoScore`, `geoSscore`, `grade` (red/yellow/green)
- A per-check checklist (`passed` / `detail`) for the UI
- **Extracted Q&A pairs** — the raw material for two downstream features:
  1. **FAQPage schema generation** (rank math "schema readiness" becomes real)
  2. **The Answer Library** — a client-facing page of Q&A content optimized for AI citation (the tryaeos.com answer-library equivalent)

## Hybrid LLM mode (opt-in)

The heuristic engine is free and always-on, but it can't judge intent, entity
authority, or answer completeness the way a model can. `scoreAeoGeoWithLLM()`
runs the same pillars through the tenant's configured text model, and
`resolveAeoGeoScore(input, { tenantId, useLlm })` is the hybrid entry point:

- **Default** — heuristic, zero cost, runs on every piece of content.
- **Opt-in deep check** — `useLlm: true` calls the model once and returns its
  score + checklist + curated Q&A pairs; if no key is configured or the call
  fails, it transparently falls back to the heuristic result.
- **Cost guardrail** — the LLM pass is never invoked implicitly on the
  high-volume generation path. It only runs where a caller explicitly opts in
  (editor "AI deep check" button, or an admin-enabled publish gate).

## Wiring plan (next steps)

1. **Compute on save:** call `scoreAeoGeo()` alongside `rankMathScore()` in
   `cherylGenerateBlog` and the manual generate-content pipeline; store
   `seo_score` (existing) + new `aeo_geo_score JSONB` column (migration).
2. **UI:** show SEO / AEO / GEO as three chips on every post in Recent Content
   and the calendar dialog, with the AEO/GEO checklist expandable.
3. **Client reports:** the per-workspace analytics dashboard (already planned)
   surfaces the three scores per piece and per workspace average.
4. **Answer library:** derive from `qaPairs` + generated FAQPage JSON-LD.

## Honesty guardrails

Same rules as the SEO fix: scores are **heuristic estimates**, not measured
rankings. Every surface labels them as such ("AI-estimated readiness, not a
guarantee of citation"). No invented external data — the engine only measures
the content's own structure and text.
