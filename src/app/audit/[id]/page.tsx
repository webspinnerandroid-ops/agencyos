"use client";

import { useState, useEffect, Fragment } from "react";
import { useParams } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Loader2, ChevronDown, ChevronRight } from "lucide-react";
import { ScoreBreakdown } from "@/components/seo/score-breakdown";

// ============================================================================
// Types
// ============================================================================

interface AuditIssue {
  severity: "high" | "medium" | "low";
  description: string;
  category?: string;
}

interface EngineCheck {
  id: string;
  label: string;
  category: string;
  maxPoints: number;
  earned: number;
  passed: boolean;
  detail: string;
}

interface AuditReport {
  url: string;
  location: string | null;
  tierName: string | null;
  tierPrice: number | null;
  status: string | null;
  scannedAt: string | null;
  overallScore: number | null;
  pageSpeedScore: number | null;
  wordCount: number | null;
  loadTimeMs: number | null;
  pagesCrawled: number | null;
  technicalIssues: AuditIssue[];
  onPageIssues: AuditIssue[];
  contentGaps: string[];
  issues: AuditIssue[];
  hasContentScores: boolean;
  brandKeyword: string | null;
  seoContent: {
    total: number;
    grade: "red" | "yellow" | "green";
    keyword: string;
    wordCount: number;
    checks: EngineCheck[];
  } | null;
  aeoGeo: {
    total: number;
    aeoScore: number;
    geoSscore: number;
    grade: "red" | "yellow" | "green";
    checks: EngineCheck[];
    wordCount: number;
  } | null;
  competitors: {
    competitorUrl: string;
    seoScore?: number | null;
    aeoScore?: number | null;
    geoScore?: number | null;
    competitorWordCount?: number | null;
    crawled?: boolean;
    crawlNote?: string;
    seoChecks?: EngineCheck[];
    aeoGeoChecks?: EngineCheck[];
  }[];
}

// ============================================================================
// Helpers
// ============================================================================

function gradeColor(score: number | null | undefined): string {
  if (score == null) return "text-muted-foreground";
  if (score >= 81) return "text-green-600 dark:text-green-400";
  if (score >= 50) return "text-yellow-600 dark:text-yellow-400";
  return "text-red-600 dark:text-red-400";
}

function gradeLabel(score: number | null | undefined): string {
  if (score == null) return "—";
  if (score >= 81) return "Good";
  if (score >= 50) return "Needs work";
  return "Poor";
}

const SEVERITY_STYLES: Record<string, string> = {
  high: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  medium: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  low: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
};

/** Circular score dial (pure SVG, no deps). */
function ScoreDial({
  label,
  score,
  sub,
}: {
  label: string;
  score: number | null;
  sub?: string;
}) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const pct = score == null ? 0 : Math.max(0, Math.min(100, score)) / 100;
  const color =
    score == null
      ? "var(--muted-foreground)"
      : pct >= 0.81
        ? "#22c55e"
        : pct >= 0.5
          ? "#eab308"
          : "#ef4444";
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative size-32">
        <svg viewBox="0 0 120 120" className="size-32 -rotate-90">
          <circle cx="60" cy="60" r={r} fill="none" stroke="currentColor" strokeWidth="10" className="text-muted" />
          <circle
            cx="60"
            cy="60"
            r={r}
            fill="none"
            stroke={color}
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - pct)}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`text-2xl font-bold ${gradeColor(score)}`}>
            {score == null ? "—" : score}
          </span>
          <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
            /100
          </span>
        </div>
      </div>
      <span className="text-sm font-medium text-center">{label}</span>
      {sub && <span className="text-[11px] text-muted-foreground">{sub}</span>}
    </div>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

// ============================================================================
// Page Component
// ============================================================================

export default function PublicAuditReportPage() {
  const { id } = useParams<{ id: string }>();
  const [report, setReport] = useState<AuditReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Competitor URLs whose per-check score breakdowns are expanded.
  const [expandedComps, setExpandedComps] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        setLoading(true);
        const res = await fetch(`/api/seo/public-audit/${encodeURIComponent(id)}`);
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Could not load the audit report.");
          return;
        }
        setReport(data);
      } catch {
        setError("Network error while loading the report.");
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <Loader2 className="size-8 animate-spin text-primary mx-auto" />
          <p className="text-muted-foreground">Loading audit report…</p>
        </div>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full p-8 text-center">
          <h1 className="text-xl font-semibold text-red-600 mb-2">
            Audit Report Unavailable
          </h1>
          <p className="text-muted-foreground text-sm">{error ?? "Report not found."}</p>
          <p className="text-xs text-muted-foreground mt-4">
            Please contact your agency for a valid audit link.
          </p>
        </Card>
      </div>
    );
  }

  const allChecks = [
    ...(report.seoContent?.checks ?? []),
    ...(report.aeoGeo?.checks ?? []),
  ];
  const failedChecks = allChecks.filter((c) => !c.passed);

  // What-to-fix: high-severity issues first, then failed engine checks.
  const fixes: string[] = [];
  for (const issue of report.issues) {
    if (issue.severity === "high") {
      fixes.push(`[High · ${issue.category ?? "Issue"}] ${issue.description}`);
    }
  }
  for (const issue of report.issues) {
    if (issue.severity === "medium") {
      fixes.push(`[Medium · ${issue.category ?? "Issue"}] ${issue.description}`);
    }
  }
  for (const c of failedChecks) {
    fixes.push(`[Score] ${c.label}: ${c.detail}`);
  }

  return (
    <div className="min-h-screen bg-background p-4 md:p-8 print:bg-white print:p-0">
      <div className="max-w-5xl mx-auto space-y-8 print:max-w-none print:space-y-6">
        {/* Header */}
        <div className="text-center space-y-2 print:mt-0">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">
            SEO Website Audit Report
          </p>
          <h1 className="text-3xl font-bold tracking-tight">
            {report.url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
          </h1>
          <p className="text-muted-foreground text-sm">
            Audited {formatDate(report.scannedAt)}
            {report.location ? ` · Location: ${report.location}` : ""}
            {report.pagesCrawled != null ? ` · ${report.pagesCrawled} page(s) crawled` : ""}
          </p>
          <button
            onClick={() => window.print()}
            className="print:hidden mt-4 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            🖨 Print / Save as PDF
          </button>
        </div>

        {/* Score dials */}
        <Card className="p-6 print:break-inside-avoid">
          <h2 className="text-lg font-semibold mb-4 text-center">Site Scores</h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <ScoreDial
              label="Overall SEO"
              score={report.overallScore}
              sub={gradeLabel(report.overallScore)}
            />
            {report.hasContentScores ? (
              <>
                <ScoreDial
                  label="SEO Content"
                  score={report.seoContent?.total ?? null}
                  sub={report.brandKeyword ? `vs “${report.brandKeyword}”` : undefined}
                />
                <ScoreDial
                  label="AEO (AI Answers)"
                  score={report.aeoGeo?.aeoScore ?? null}
                  sub="answer-engine ready"
                />
                <ScoreDial
                  label="GEO (AI Citation)"
                  score={report.aeoGeo?.geoSscore ?? null}
                  sub="generative-engine ready"
                />
              </>
            ) : (
              <p className="col-span-3 text-sm text-muted-foreground flex items-center justify-center">
                AEO/GEO content scores require homepage text to analyze.
              </p>
            )}
            <ScoreDial
              label="Page Speed"
              score={report.pageSpeedScore}
              sub={report.loadTimeMs != null ? `${(report.loadTimeMs / 1000).toFixed(1)}s load` : undefined}
            />
          </div>
        </Card>

        {/* How the scores are made — per-check breakdowns */}
        {report.hasContentScores && (
          <Card className="p-6 print:break-inside-avoid">
            <div className="flex items-center justify-between gap-2 mb-4">
              <div>
                <h2 className="text-lg font-semibold">How the scores are made</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Every point behind each score — tap a score to expand its check-by-check breakdown.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <ScoreBreakdown
                title="SEO Content"
                score={report.seoContent?.total ?? null}
                subtitle={report.brandKeyword ? `vs “${report.brandKeyword}”` : undefined}
                seoChecks={report.seoContent?.checks ?? []}
                defaultCollapsed={false}
              />
              <ScoreBreakdown
                title="AEO"
                score={report.aeoGeo?.aeoScore ?? null}
                subtitle="answer-engine ready"
                aeoGeoChecks={report.aeoGeo?.checks ?? []}
              />
              <ScoreBreakdown
                title="GEO"
                score={report.aeoGeo?.geoSscore ?? null}
                subtitle="generative-engine ready"
                aeoGeoChecks={report.aeoGeo?.checks ?? []}
              />
            </div>
          </Card>
        )}

        {/* What to fix */}
        {fixes.length > 0 && (
          <Card className="p-6 border-amber-300 dark:border-amber-800 print:break-inside-avoid">
            <h2 className="text-lg font-semibold mb-1 flex items-center gap-2">
              <span className="text-amber-500">⚙</span> What to fix first
            </h2>
            <p className="text-xs text-muted-foreground mb-4">
              Ordered by impact — high-severity issues, then medium, then scoring gaps.
            </p>
            <ul className="space-y-2">
              {fixes.slice(0, 14).map((f, i) => (
                <li key={i} className="text-sm flex items-start gap-2">
                  <span className="text-amber-500 mt-0.5 shrink-0">→</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {/* Issue checklist */}
        <Card className="p-6 print:break-inside-avoid">
          <h2 className="text-lg font-semibold mb-4">Issue Checklist</h2>
          {report.issues.length === 0 && failedChecks.length === 0 ? (
            <p className="text-sm text-green-600">
              No issues detected. The site is in strong shape.
            </p>
          ) : (
            <div className="space-y-3">
              {report.issues.map((issue, i) => (
                <div
                  key={`issue-${i}`}
                  className="flex items-start gap-3 p-3 rounded-lg border text-sm"
                >
                  <span className={`px-2 py-0.5 rounded text-xs font-semibold uppercase mt-0.5 shrink-0 ${SEVERITY_STYLES[issue.severity] ?? SEVERITY_STYLES.low}`}>
                    {issue.severity}
                  </span>
                  <div>
                    <span className="text-xs font-medium text-muted-foreground">
                      {issue.category ?? "Issue"}
                    </span>
                    <p>{issue.description}</p>
                  </div>
                </div>
              ))}
              {failedChecks.map((c) => (
                <div
                  key={`check-${c.id}`}
                  className="flex items-start gap-3 p-3 rounded-lg border text-sm"
                >
                  <span className="px-2 py-0.5 rounded text-xs font-semibold uppercase mt-0.5 shrink-0 bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300">
                    Fail
                  </span>
                  <div>
                    <span className="text-xs font-medium text-muted-foreground">
                      {c.category} · {c.maxPoints} pts
                    </span>
                    <p className="font-medium">{c.label}</p>
                    <p className="text-xs text-muted-foreground">{c.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Competitor benchmark */}
        {report.competitors.length > 0 && (
          <Card className="p-6 print:break-inside-avoid">
            <h2 className="text-lg font-semibold mb-4">Competitor Benchmark</h2>
            <p className="text-xs text-muted-foreground mb-4">
              Same scoring engine as this audit, run on each competitor's homepage —
              compare on equal terms.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-4">Competitor</th>
                    <th className="py-2 pr-4 text-right">SEO</th>
                    <th className="py-2 pr-4 text-right">AEO</th>
                    <th className="py-2 pr-4 text-right">GEO</th>
                    <th className="py-2 text-right">Words</th>
                  </tr>
                </thead>
                <tbody>
                  {report.competitors.map((c, i) => {
                    const hasBreakdown =
                      (c.seoChecks?.length ?? 0) + (c.aeoGeoChecks?.length ?? 0) > 0;
                    const isExpanded = expandedComps.has(c.competitorUrl);
                    const toggle = () => {
                      setExpandedComps((prev) => {
                        const next = new Set(prev);
                        if (next.has(c.competitorUrl)) next.delete(c.competitorUrl);
                        else next.add(c.competitorUrl);
                        return next;
                      });
                    };
                    return (
                      <Fragment key={i}>
                        <tr className="border-b last:border-0">
                          <td className="py-2 pr-4 font-medium break-all">
                            <span className="inline-flex items-center gap-1">
                              {hasBreakdown && (
                                <button
                                  type="button"
                                  onClick={toggle}
                                  className="text-muted-foreground hover:text-foreground shrink-0"
                                  title="Show how this score was made"
                                >
                                  {isExpanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                                </button>
                              )}
                              {c.competitorUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                            </span>
                            {c.crawled === false && (
                              <span className="block text-[10px] font-normal text-amber-600 dark:text-amber-500 mt-0.5 italic">
                                Not crawlable — {c.crawlNote ?? "could not be crawled"}
                              </span>
                            )}
                          </td>
                          <td className={`py-2 pr-4 text-right font-bold ${gradeColor(c.seoScore)}`}>{c.seoScore ?? "—"}</td>
                          <td className={`py-2 pr-4 text-right font-bold ${gradeColor(c.aeoScore)}`}>{c.aeoScore ?? "—"}</td>
                          <td className={`py-2 pr-4 text-right font-bold ${gradeColor(c.geoScore)}`}>{c.geoScore ?? "—"}</td>
                          <td className="py-2 text-right text-muted-foreground">
                            {c.competitorWordCount != null ? c.competitorWordCount.toLocaleString() : "—"}
                          </td>
                        </tr>
                        {isExpanded && hasBreakdown && (
                          <tr className="border-b bg-muted/30">
                            <td colSpan={5} className="py-3 px-2">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <ScoreBreakdown
                                  title="SEO"
                                  score={c.seoScore ?? null}
                                  seoChecks={c.seoChecks ?? []}
                                  defaultCollapsed={false}
                                />
                                <ScoreBreakdown
                                  title="AEO + GEO"
                                  score={
                                    c.aeoScore != null && c.geoScore != null
                                      ? Math.round((c.aeoScore + c.geoScore) / 2)
                                      : null
                                  }
                                  aeoGeoChecks={c.aeoGeoChecks ?? []}
                                  defaultCollapsed={false}
                                />
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {report.competitors.some((c) => c.crawled === false) && (
              <p className="text-xs text-amber-600 dark:text-amber-500 mt-3 italic">
                {report.competitors.filter((c) => c.crawled === false).length} competitor(s) could
                not be fully crawled ({report.competitors.filter((c) => c.crawled === false).map((c) => c.competitorUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")).join(", ")})
                — scores shown are for the fully-crawled competitors.
              </p>
            )}
            {report.competitors.some((c) => c.seoScore == null && c.crawled !== false) && (
              <p className="text-xs text-muted-foreground mt-2 italic">
                Audits run before competitor scoring was added show blank scores — re-run the
                audit to benchmark.
              </p>
            )}
          </Card>
        )}

        {/* Content gaps */}
        {report.contentGaps.length > 0 && (
          <Card className="p-6 print:break-inside-avoid">
            <h2 className="text-lg font-semibold mb-4">Content Opportunities</h2>
            <ul className="space-y-1.5">
              {report.contentGaps.map((gap, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                  <span className="text-green-500 mt-0.5">+</span>
                  {gap}
                </li>
              ))}
            </ul>
          </Card>
        )}

        {/* Footer */}
        <p className="text-center text-xs text-muted-foreground">
          {report.hasContentScores
            ? "Overall SEO is a full-site crawl score; SEO Content, AEO and GEO scores are computed from the homepage by our scoring engine (0–100). "
            : ""}
          Scores are indicative — ask your agency for the full recommendation.
        </p>
      </div>
    </div>
  );
}
