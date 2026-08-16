"use client";

import { Fragment } from "react";

// ============================================================================
// Side-by-side rewrite comparison — every ranking factor with its before and
// after score, per engine (SEO / AEO / GEO). Used on the rewriter result page
// and the Monitored Sites rewrite detail view.
// ============================================================================

export interface ComparisonCheck {
  id: string;
  label: string;
  category?: string;
  pillar?: string;
  maxPoints: number;
  earned: number;
  passed: boolean;
  detail: string;
}

export interface RewriteComparisonTableProps {
  title?: string;
  beforeSeo: ComparisonCheck[];
  beforeAeoGeo: ComparisonCheck[];
  afterSeo: ComparisonCheck[];
  afterAeoGeo: ComparisonCheck[];
  beforeSeoScore?: number | null;
  afterSeoScore?: number | null;
  beforeAeoScore?: number | null;
  afterAeoScore?: number | null;
  beforeGeoScore?: number | null;
  afterGeoScore?: number | null;
}

function scoreTone(v: number): string {
  if (v >= 81) return "text-green-600 dark:text-green-400";
  if (v >= 50) return "text-yellow-600 dark:text-yellow-400";
  return "text-red-600 dark:text-red-400";
}

interface Row {
  id: string;
  label: string;
  group: string;
  before: { earned: number; max: number; passed: boolean } | null;
  after: { earned: number; max: number; passed: boolean } | null;
  delta: number;
}

function buildRows(before: ComparisonCheck[], after: ComparisonCheck[]): Row[] {
  const mapBefore = new Map(before.map((c) => [c.id, c] as const));
  const mapAfter = new Map(after.map((c) => [c.id, c] as const));
  const ids = [...new Set([...mapBefore.keys(), ...mapAfter.keys()])];
  return ids.map((id) => {
    const cb = mapBefore.get(id);
    const ca = mapAfter.get(id);
    const label = (ca ?? cb)?.label ?? id;
    const group = (ca ?? cb)?.pillar ?? (ca ?? cb)?.category ?? "Factors";
    return {
      id,
      label,
      group,
      before: cb ? { earned: cb.earned, max: cb.maxPoints, passed: cb.passed } : null,
      after: ca ? { earned: ca.earned, max: ca.maxPoints, passed: ca.passed } : null,
      delta: (ca?.earned ?? 0) - (cb?.earned ?? 0),
    };
  });
}

function ScoreCell({ cell }: { cell: { earned: number; max: number; passed: boolean } | null }) {
  if (!cell) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      {cell.passed ? (
        <span className="text-green-600 dark:text-green-400 text-[10px]">✓</span>
      ) : (
        <span className="text-red-600 dark:text-red-400 text-[10px]">✗</span>
      )}
      <span className={scoreTone(cell.earned)}>{cell.earned}</span>
      <span className="text-muted-foreground/60">/{cell.max}</span>
    </span>
  );
}

function SectionTable({
  engine,
  beforeScore,
  afterScore,
  rows,
}: {
  engine: string;
  beforeScore: number | null;
  afterScore: number | null;
  rows: Row[];
}) {
  if (rows.length === 0) return null;
  const groups: { name: string; rows: Row[] }[] = [];
  for (const r of rows) {
    const g = groups.find((x) => x.name === r.group);
    if (g) g.rows.push(r);
    else groups.push({ name: r.group, rows: [r] });
  }
  return (
    <div className="mt-5 first:mt-0">
      <div className="flex items-baseline gap-2 mb-1">
        <span className="text-sm font-semibold">{engine}</span>
        <span className="text-xs tabular-nums">
          <span className={scoreTone(beforeScore ?? 0)}>{beforeScore ?? "—"}</span>
          <span className="text-muted-foreground"> → </span>
          <span className={scoreTone(afterScore ?? 0)}>{afterScore ?? "—"}</span>
          <span className="text-muted-foreground">/100</span>
        </span>
        {beforeScore != null && afterScore != null && afterScore - beforeScore !== 0 && (
          <span
            className={`text-[11px] font-medium ${
              afterScore > beforeScore
                ? "text-green-600 dark:text-green-400"
                : "text-red-600 dark:text-red-400"
            }`}
          >
            {afterScore > beforeScore ? "▲" : "▼"} {Math.abs(afterScore - beforeScore)}
          </span>
        )}
      </div>
      <div className="rounded-lg border overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-[10px] uppercase tracking-wide text-muted-foreground bg-muted/40">
              <th className="py-2 pl-3 pr-3 font-medium">Ranking factor</th>
              <th className="py-2 pr-3 font-medium text-right">Before</th>
              <th className="py-2 pr-3 font-medium text-right">After</th>
              <th className="py-2 pr-3 font-medium text-right">Δ</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <Fragment key={g.name}>
                {g.rows.map((r, i) => (
                  <tr key={r.id} className="border-b last:border-0 align-top">
                    <td className="py-2 pl-3 pr-3 min-w-0">
                      {i === 0 && (
                        <span className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">
                          {g.name}
                        </span>
                      )}
                      <span className="font-medium break-words">{r.label}</span>
                      {r.after?.passed === false && (
                        <span className="ml-1.5 text-[9px] text-red-600 dark:text-red-400 uppercase align-middle">
                          fail
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      <ScoreCell cell={r.before} />
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      <ScoreCell cell={r.after} />
                    </td>
                    <td
                      className={`py-2 pr-3 text-right font-bold tabular-nums ${
                        r.delta > 0
                          ? "text-green-600 dark:text-green-400"
                          : r.delta < 0
                            ? "text-red-600 dark:text-red-400"
                            : "text-muted-foreground"
                      }`}
                    >
                      {r.delta > 0 ? `+${r.delta}` : r.delta}
                    </td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function RewriteComparisonTable({
  title = "Side-by-side factors",
  beforeSeo,
  beforeAeoGeo,
  afterSeo,
  afterAeoGeo,
  beforeSeoScore,
  afterSeoScore,
  beforeAeoScore,
  afterAeoScore,
  beforeGeoScore,
  afterGeoScore,
}: RewriteComparisonTableProps) {
  const seoRows = buildRows(beforeSeo, afterSeo);
  const aeoRows = buildRows(
    beforeAeoGeo.filter((c) => c.pillar === "AEO"),
    afterAeoGeo.filter((c) => c.pillar === "AEO")
  );
  const geoRows = buildRows(
    beforeAeoGeo.filter((c) => c.pillar === "GEO"),
    afterAeoGeo.filter((c) => c.pillar === "GEO")
  );

  if (seoRows.length + aeoRows.length + geoRows.length === 0) return null;

  return (
    <div>
      <h3 className="text-sm font-semibold mb-1">{title}</h3>
      <p className="text-[11px] text-muted-foreground mb-2">
        Every ranking factor with its before → after score for the rewrite.
      </p>
      <SectionTable engine="SEO" beforeScore={beforeSeoScore ?? null} afterScore={afterSeoScore ?? null} rows={seoRows} />
      <SectionTable engine="AEO" beforeScore={beforeAeoScore ?? null} afterScore={afterAeoScore ?? null} rows={aeoRows} />
      <SectionTable engine="GEO" beforeScore={beforeGeoScore ?? null} afterScore={afterGeoScore ?? null} rows={geoRows} />
    </div>
  );
}
