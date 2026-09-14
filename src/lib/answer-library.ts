/**
 * Answer Library helpers — pure functions, no I/O.
 *
 * The Answer Library (dashboard/answer-library) aggregates the Q&A pairs the
 * AEO/GEO engine extracts from every blog post (content.aeoGeo.qaPairs).
 * This module turns those entries into the FAQPage JSON-LD the design doc
 * (docs/aeo-geo-scoring.md, "What the engine emits") calls the downstream
 * payoff: "schema readiness becomes real" — the library's answers ship as
 * FAQPage structured data any page can embed.
 */

export interface AnswerLibraryEntry {
  q: string;
  a: string;
  /** Source post id — used for dedupe grouping and traceability. */
  postId: string;
}

/**
 * Collapse duplicate questions across posts (the same "What is X?" is often
 * answered by several posts) into a single entry that keeps the highest
 * AEO/GEO-scored post's answer — with all extra fields of the surviving
 * entry intact (generic, so the page can pass its enriched rows).
 * Order: score desc, then question asc for a stable, deterministic listing.
 */
export function dedupeEntries<T extends { q: string; a: string; postId: string }>(
  entries: T[],
  scoreOf: (postId: string) => number
): T[] {
  const best = new Map<string, { entry: T; score: number }>();
  for (const e of entries) {
    if (!e.q?.trim() || !e.a?.trim()) continue;
    const key = e.q.trim().toLowerCase();
    const score = scoreOf(e.postId) ?? 0;
    const prev = best.get(key);
    if (!prev || score > prev.score) {
      best.set(key, { entry: e, score });
    }
  }
  return [...best.values()]
    .sort((a, b) => b.score - a.score || a.entry.q.localeCompare(b.entry.q))
    .map((v) => v.entry);
}

/**
 * Build a copy-ready FAQPage JSON-LD block from library entries.
 * Encodes angle brackets so a `</script>` inside an answer can never break
 * out of the script tag when embedded.
 */
export function buildAnswerFaqSchema(
  entries: { q: string; a: string }[],
  opts?: { name?: string; url?: string }
): string {
  const schema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    name: opts?.name ?? "Answer Library",
    ...(opts?.url ? { url: opts.url } : {}),
    mainEntity: entries
      .filter((e) => e.q?.trim() && e.a?.trim())
      .slice(0, 50)
      .map((e) => ({
        "@type": "Question",
        name: e.q.trim(),
        acceptedAnswer: {
          "@type": "Answer",
          text: e.a.trim(),
        },
      })),
  };
  return JSON.stringify(schema, null, 2).replace(/</g, "\\u003c");
}
