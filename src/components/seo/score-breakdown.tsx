"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

// ============================================================================
// Types — mirror the engine check shapes so this component works for both
// the on-page SEO engine and the AEO/GEO engine without imports.
// ============================================================================

export interface SeoCheckShape {
  id: string;
  label: string;
  category?: string;
  maxPoints: number;
  earned: number;
  passed: boolean;
  detail: string;
}

export interface AeoGeoCheckShape {
  id: string;
  label: string;
  pillar?: string;
  category?: string;
  maxPoints: number;
  earned: number;
  passed: boolean;
  detail: string;
}

export interface ScoreBreakdownProps {
  /** Section title, e.g. "SEO Content" or "techwyse.com". */
  title: string;
  /** Overall score for the engine (0–100). */
  score: number | null;
  /** Subtitle under the title, e.g. the keyword scored against. */
  subtitle?: string;
  seoChecks?: SeoCheckShape[];
  aeoGeoChecks?: AeoGeoCheckShape[];
  /** Collapse by default; expand on click. Default true. */
  defaultCollapsed?: boolean;
}

// ============================================================================
// Component
// ============================================================================

function scoreTone(v: number): string {
  if (v >= 81) return "text-green-600 dark:text-green-400";
  if (v >= 50) return "text-yellow-600 dark:text-yellow-400";
  return "text-red-600 dark:text-red-400";
}

function CheckRow({
  label,
  category,
  maxPoints,
  earned,
  passed,
  detail,
}: {
  label: string;
  category: string;
  maxPoints: number;
  earned: number;
  passed: boolean;
  detail: string;
}) {
  return (
    <div className="flex items-start gap-2 py-1.5 border-b last:border-0 text-xs">
      <span className="mt-0.5 shrink-0 text-[10px] font-bold uppercase tracking-wide w-8 text-center">
        {passed ? (
          <span className="text-green-600 dark:text-green-400">✓</span>
        ) : (
          <span className="text-red-600 dark:text-red-400">✗</span>
        )}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium truncate" title={label}>
            {label}
          </span>
          <span className="shrink-0 tabular-nums text-muted-foreground">
            <span className={scoreTone(earned)}>{earned}</span>
            <span className="text-muted-foreground/60">/{maxPoints}</span>
          </span>
        </div>
        <div className="text-[11px] text-muted-foreground mt-0.5">{detail}</div>
      </div>
    </div>
  );
}

export function ScoreBreakdown({
  title,
  score,
  subtitle,
  seoChecks,
  aeoGeoChecks,
  defaultCollapsed = true,
}: ScoreBreakdownProps) {
  const [open, setOpen] = useState(!defaultCollapsed);
  const hasChecks = (seoChecks?.length ?? 0) + (aeoGeoChecks?.length ?? 0) > 0;

  if (score == null && !hasChecks) {
    return (
      <div className="rounded-lg border p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">{title}</span>
          <span className="text-xs text-muted-foreground">No score</span>
        </div>
      </div>
    );
  }

  const seoGroups: { category: string; checks: SeoCheckShape[] }[] = [];
  for (const c of seoChecks ?? []) {
    const cat = c.category ?? "SEO";
    const group = seoGroups.find((g) => g.category === cat);
    if (group) group.checks.push(c);
    else seoGroups.push({ category: cat, checks: [c] });
  }

  const aeoChecks = (aeoGeoChecks ?? []).filter((c) => c.pillar === "AEO");
  const geoChecks = (aeoGeoChecks ?? []).filter((c) => c.pillar === "GEO");
  // If checks have no pillar field (SEO checks passed through), show them under SEO.
  const unclassified = (aeoGeoChecks ?? []).filter((c) => c.pillar !== "AEO" && c.pillar !== "GEO");

  return (
    <div className="rounded-lg border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 p-3 text-left hover:bg-muted/50 transition-colors"
      >
        <span className="flex items-center gap-2 min-w-0">
          {open ? (
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          )}
          <span className="text-sm font-medium truncate" title={title}>
            {title}
          </span>
          {subtitle && (
            <span className="hidden sm:inline text-[11px] text-muted-foreground truncate">
              {subtitle}
            </span>
          )}
        </span>
        <span className={`text-sm font-bold shrink-0 tabular-nums ${scoreTone(score ?? 0)}`}>
          {score != null ? `${score}/100` : "—"}
        </span>
      </button>

      {open && (
        <div className="px-3 pb-3">
          {seoGroups.map((group) => (
            <div key={group.category} className="mt-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                {group.category}
              </div>
              <div>
                {group.checks.map((c) => (
                  <CheckRow key={c.id} label={c.label} category={c.category ?? "SEO"} maxPoints={c.maxPoints} earned={c.earned} passed={c.passed} detail={c.detail} />
                ))}
              </div>
            </div>
          ))}
          {aeoChecks.length > 0 && (
            <div className="mt-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                AEO — Answer-engine optimization
              </div>
              <div>
                {aeoChecks.map((c) => (
                  <CheckRow key={c.id} label={c.label} category={c.pillar ?? "AEO"} maxPoints={c.maxPoints} earned={c.earned} passed={c.passed} detail={c.detail} />
                ))}
              </div>
            </div>
          )}
          {geoChecks.length > 0 && (
            <div className="mt-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                GEO — Generative-engine optimization
              </div>
              <div>
                {geoChecks.map((c) => (
                  <CheckRow key={c.id} label={c.label} category={c.pillar ?? "GEO"} maxPoints={c.maxPoints} earned={c.earned} passed={c.passed} detail={c.detail} />
                ))}
              </div>
            </div>
          )}
          {unclassified.length > 0 && (
            <div className="mt-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                Checks
              </div>
              <div>
                {unclassified.map((c) => (
                  <CheckRow key={c.id} label={c.label} category={c.category ?? "Check"} maxPoints={c.maxPoints} earned={c.earned} passed={c.passed} detail={c.detail} />
                ))}
              </div>
            </div>
          )}
          {!hasChecks && (
            <p className="text-[11px] text-muted-foreground mt-2">
              No per-check breakdown available for this score.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
