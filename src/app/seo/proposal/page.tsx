"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import type { KeywordRank } from "@/lib/seo/keyword-rankings";

// ============================================================================
// Types
// ============================================================================

interface StoredCampaign {
  id: string;
  tenant_id: string;
  client_id: string;
  url: string;
  tier_name: string;
  tier_price: number;
  status: string;
  campaign_json: CampaignJson;
  audit_json?: AuditJson;
  competitors_json?: CompetitorData[];
  social_research_json?: {
    brands: {
      name: string;
      url: string;
      platforms: { platform: string; url: string | null; active: boolean; notes: string }[];
    }[];
    overall: string;
  };
  created_at: string;
  docusign_envelope_id?: string | null;
  docusign_status?: string | null;
  docusign_signed_at?: string | null;
  signer_name?: string | null;
  signer_email?: string | null;
  signed_document_url?: string | null;
}

interface CampaignJson {
  tierName: string;
  tierPrice: number;
  executiveSummary: string;
  targetKeywords: {
    keyword: string;
    searchVolume: number;
    difficulty: string;
    currentRanking: number | null;
    targetRanking: number;
    intent: string;
  }[];
  contentCalendar: {
    month: number;
    focusArea: string;
    contentPieces: {
      type: string;
      title: string;
      targetKeyword: string;
      description: string;
      estimatedWordCount: number;
      priority: string;
    }[];
    technicalTasks: string[];
    linkBuildingTasks: string[];
    expectedOutcomes: string;
  }[];
  deliverables?: string[];
  estimatedROI?: string;
  differentiators?: string[];
}

interface AuditJson {
  url: string;
  overallScore: number;
  technicalIssues: { severity: string; description: string }[];
  onPageIssues: { severity: string; description: string }[];
  contentGaps: string[];
  pageSpeedScore?: number;
  homepage?: { title: string; metaDescription: string; wordCount: number; loadTimeMs: number };
  internalPages?: any[];
}

interface CompetitorData {
  competitorUrl: string;
  strengths: string[];
  weaknesses: string[];
  topKeywords: string[];
  contentStrategy: string;
  seoScore?: number | null;
  aeoScore?: number | null;
  geoScore?: number | null;
  competitorWordCount?: number | null;
  crawled?: boolean;
  scoredAt?: string | null;
}

// ============================================================================
// Page Component
// ============================================================================

export default function PublicSeoProposalPage() {
  const searchParams = useSearchParams();
  const clientId = searchParams.get("clientId");

  const [campaigns, setCampaigns] = useState<StoredCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedTier, setExpandedTier] = useState<string | null>(null);
  const [selectedCampaign, setSelectedCampaign] = useState<StoredCampaign | null>(null);
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);
  const [signStatus, setSignStatus] = useState<string | null>(null);
  const [rankings, setRankings] = useState<Record<string, Record<string, KeywordRank>>>({});

  const fetchProposals = useCallback(async () => {
    if (!clientId) {
      setError("No client ID provided. Please use a valid proposal link.");
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const res = await fetch(`/api/seo/public-proposal?clientId=${encodeURIComponent(clientId)}`);

      if (!res.ok) {
        const errData = await res.json();
        setError((errData as { error?: string }).error ?? "Failed to load proposals");
        return;
      }

      const data = await res.json();
      const proposed = (data.campaigns ?? []).filter(
        (c: StoredCampaign) => c.status === "proposed" || c.status === "approved" || c.status === "active"
      );
      setCampaigns(proposed);
      setRankings(data.rankings ?? {});
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load proposals");
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    fetchProposals();
  }, [fetchProposals]);

  // Load the signing status when a tier is opened.
  useEffect(() => {
    if (!selectedCampaign || !clientId) return;
    setSignStatus(null);
    setSignError(null);
    if (selectedCampaign.docusign_status) {
      setSignStatus(selectedCampaign.docusign_status);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/seo/public-proposal/${selectedCampaign.id}/sign?clientId=${encodeURIComponent(clientId)}`
        );
        if (res.ok) {
          const data = await res.json();
          if (!cancelled && data.status) setSignStatus(data.status);
        }
      } catch {
        // ignore — DocuSign may simply not be configured
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedCampaign, clientId]);

  // Approve & sign this tier. The signing page (/sign/[token]) lets the
  // client review the terms and sign (typed or drawn); once signed, the
  // agreement is archived and the campaign auto-starts.
  const handleSign = async () => {
    if (!selectedCampaign || !clientId) return;
    setSigning(true);
    setSignError(null);
    try {
      const res = await fetch(
        `/api/seo/public-proposal/${selectedCampaign.id}/sign?clientId=${encodeURIComponent(clientId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSignError(data.error ?? "Could not start signing.");
        return;
      }
      setSignStatus(data.status ?? "sent");
      if (data.signUrl) {
        // Full signing flow in the same tab; the proposal page refreshes its
        // status when the client comes back.
        window.location.href = data.signUrl;
      }
    } catch {
      setSignError("Network error while starting signing.");
    } finally {
      setSigning(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full mx-auto" />
          <p className="text-muted-foreground">Loading proposals...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full p-8 text-center">
          <h2 className="text-xl font-semibold text-red-600 mb-2">Unable to Load Proposals</h2>
          <p className="text-muted-foreground text-sm">{error}</p>
          <p className="text-xs text-muted-foreground mt-4">
            Please contact your agency for a valid proposal link.
          </p>
        </Card>
      </div>
    );
  }

  if (campaigns.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full p-8 text-center">
          <h2 className="text-xl font-semibold mb-2">No Proposals Yet</h2>
          <p className="text-muted-foreground text-sm">
            Your agency has not yet shared any SEO proposals with you. Once they do, you'll be able to view them here.
          </p>
        </Card>
      </div>
    );
  }

  // Show tier selection if none selected yet
  if (!selectedCampaign) {
    return (
      <div className="min-h-screen bg-background p-4 md:p-8">
        <div className="max-w-4xl mx-auto space-y-8">
          {/* Header */}
          <div className="text-center">
            <h1 className="text-3xl font-bold tracking-tight">SEO Proposal</h1>
            <p className="text-muted-foreground mt-2">
              Your agency has prepared the following customized SEO strategies for <strong>{campaigns[0]?.url ?? "your website"}</strong>.
              Choose the plan that best fits your goals and budget.
            </p>
          </div>

          {/* Competitor benchmark — always visible on the proposal, with an
              honest empty state when the audit had no competitors. */}
          <CompetitorBenchmark competitors={campaigns[0]?.competitors_json ?? []} />

          {/* Audit Summary */}
          {campaigns[0]?.audit_json && (
            <Card className="p-6">
              <h2 className="text-lg font-semibold mb-4">Website Audit Summary</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div className="p-3 rounded-lg bg-muted">
                  <span className="text-muted-foreground">Overall Score</span>
                  <span className={`block text-2xl font-bold ${
                    (campaigns[0].audit_json.overallScore ?? 0) >= 80 ? "text-green-500" :
                    (campaigns[0].audit_json.overallScore ?? 0) >= 50 ? "text-yellow-500" : "text-red-500"
                  }`}>
                    {campaigns[0].audit_json.overallScore}/100
                  </span>
                </div>
                <div className="p-3 rounded-lg bg-muted">
                  <span className="text-muted-foreground">Technical Issues</span>
                  <span className="block text-2xl font-bold">{campaigns[0].audit_json.technicalIssues?.length ?? 0}</span>
                </div>
                <div className="p-3 rounded-lg bg-muted">
                  <span className="text-muted-foreground">On-Page Issues</span>
                  <span className="block text-2xl font-bold">{campaigns[0].audit_json.onPageIssues?.length ?? 0}</span>
                </div>
                {(campaigns[0].audit_json.pageSpeedScore ?? 0) > 0 && (
                  <div className="p-3 rounded-lg bg-muted">
                    <span className="text-muted-foreground">Page Speed</span>
                    <span className="block text-2xl font-bold">{campaigns[0].audit_json.pageSpeedScore}/100</span>
                  </div>
                )}
              </div>
            </Card>
          )}

          {/* Tier Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
            {campaigns.map((campaign) => {
              const cj = campaign.campaign_json;
              const tierLower = (cj.tierName ?? "").toLowerCase();
              const isGoldOrCustom = tierLower.includes("gold") || tierLower.includes("custom");
              const contentCount =
                cj.contentCalendar?.reduce((sum, m) => sum + (m.contentPieces?.length ?? 0), 0) ?? 0;

              return (
                <Card
                  key={campaign.id}
                  className={`p-6 flex flex-col cursor-pointer transition-all hover:shadow-lg ${
                    isGoldOrCustom ? "ring-2 ring-primary" : ""
                  }`}
                  onClick={() => setSelectedCampaign(campaign)}
                >
                  {/* Market Leader badge */}
                  {isGoldOrCustom && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground text-xs font-semibold px-3 py-1 rounded-full">
                      Market Leader
                    </div>
                  )}

                  <span
                    className={`inline-block px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wide mb-3 ${
                      isGoldOrCustom
                        ? "bg-primary text-primary-foreground"
                        : tierLower.includes("silver")
                        ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200"
                        : tierLower.includes("bronze")
                        ? "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200"
                        : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200"
                    }`}
                  >
                    {cj.tierName}
                  </span>

                  {cj.tierPrice == null || String(cj.tierName ?? "").toLowerCase().includes("custom") ? (
                    <span className="text-lg font-bold text-primary">Custom Consult Required</span>
                  ) : (
                    <>
                      <span className="text-3xl font-bold">${cj.tierPrice.toLocaleString()}</span>
                      <span className="text-sm text-muted-foreground mb-4">/month</span>
                    </>
                  )}

                  <p className="text-sm text-muted-foreground mb-4 flex-1 line-clamp-3">
                    {cj.executiveSummary}
                  </p>

                  <div className="text-xs text-muted-foreground mb-4 space-y-1">
                    <div>{contentCount} content pieces scheduled</div>
                    <div>{cj.targetKeywords?.length ?? 0} target keywords</div>
                    {(campaign.competitors_json?.length ?? 0) > 0 ? (
                      <div>vs {campaign.competitors_json!.length} competitors benchmarked</div>
                    ) : (
                      <div className="text-muted-foreground italic">No competitor benchmark</div>
                    )}
                    {cj.estimatedROI && <div className="text-muted-foreground">Projected ROI (est.): {cj.estimatedROI}</div>}
                  </div>

                  <Button className="w-full">Select {cj.tierName}</Button>
                  {campaign.docusign_status === "completed" && (
                    <span className="mt-2 inline-flex w-full justify-center rounded-md bg-green-50 px-3 py-1.5 text-xs font-medium text-green-700">
                      ✓ Signed & approved
                    </span>
                  )}
                </Card>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // Show detailed view of selected campaign
  const cj = selectedCampaign.campaign_json;
  const audit = selectedCampaign.audit_json;
  const competitors = selectedCampaign.competitors_json ?? [];
  const socialResearch = selectedCampaign.social_research_json;

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        {/* Back button */}
        <button
          onClick={() => setSelectedCampaign(null)}
          className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"
        >
          ← Back to all proposals
        </button>

        {/* Tier Header */}
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{cj.tierName} Plan</h1>
          <p className="text-muted-foreground mt-2">
            For: <strong>{selectedCampaign.url}</strong>
          </p>
          <div className="mt-4">
            {cj.tierPrice == null || String(cj.tierName ?? "").toLowerCase().includes("custom") ? (
              <span className="text-2xl font-bold text-primary">Custom Consult Required</span>
            ) : (
              <>
                <span className="text-4xl font-bold">${cj.tierPrice.toLocaleString()}</span>
                <span className="text-muted-foreground">/month</span>
              </>
            )}
          </div>
        </div>

        {/* Approve & Sign */}
        <Card className="p-6 border-primary/40">
          <h2 className="text-lg font-semibold mb-2">Approve & Start</h2>
          <p className="text-sm text-muted-foreground mb-4">
            {signStatus === "completed"
              ? `This proposal was signed${selectedCampaign.signer_name ? ` by ${selectedCampaign.signer_name}` : ""}${
                  selectedCampaign.docusign_signed_at
                    ? ` on ${new Date(selectedCampaign.docusign_signed_at).toLocaleDateString("en-US", {
                        month: "long",
                        day: "numeric",
                        year: "numeric",
                      })}`
                    : ""
                }. Your campaign is now being set up.`
              : signStatus && signStatus !== "unsigned"
              ? "This proposal has been sent for your signature. Complete the signing page to approve it — your campaign starts automatically once signed."
              : "Approve this plan and sign it electronically. Once you sign, your agency is authorized to start the campaign right away."}
          </p>
          {signStatus === "completed" ? (
            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex items-center gap-2 rounded-md bg-green-50 px-3 py-2 text-sm font-medium text-green-700">
                <span>✓ Signed & approved</span>
              </div>
              {selectedCampaign.signed_document_url && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open(selectedCampaign.signed_document_url!, "_blank")}
                >
                  View Signed Contract
                </Button>
              )}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={handleSign} disabled={signing}>
                {signing ? (
                  <>
                    <Loader2 className="size-4 animate-spin mr-2" />
                    Preparing signing page…
                  </>
                ) : signStatus && signStatus !== "unsigned" ? (
                  "Complete your signature"
                ) : (
                  "Approve & Sign"
                )}
              </Button>
              {signStatus && signStatus !== "unsigned" && signStatus !== "completed" && (
                <span className="text-xs text-muted-foreground capitalize">
                  Status: {signStatus}
                </span>
              )}
            </div>
          )}
          {signError && (
            <p className="mt-3 text-sm text-red-600">{signError}</p>
          )}
        </Card>

        {/* Executive Summary */}
        <Card className="p-6">
          <h2 className="text-lg font-semibold mb-3">Executive Summary</h2>
          <p className="text-sm text-muted-foreground whitespace-pre-line">{cj.executiveSummary}</p>
        </Card>

        {/* Keywords */}
        {cj.targetKeywords?.length > 0 && (
          <Card className="p-6">
            <h2 className="text-lg font-semibold mb-4">Target Keywords</h2>
            <p className="text-xs text-muted-foreground mb-4">
              Note: Volume, difficulty, and ranking projections are AI estimates
              generated from this audit. Verify with a keyword tool (e.g., Ahrefs,
              Semrush, Google Search Console) before finalizing the plan.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2">Keyword</th>
                    <th className="text-left py-2">Volume (est.)</th>
                    <th className="text-left py-2">Difficulty (est.)</th>
                    <th className="text-left py-2">Intent</th>
                    <th className="text-left py-2">Current Rank</th>
                    <th className="text-left py-2">Target Rank</th>
                  </tr>
                </thead>
                <tbody>
                  {cj.targetKeywords.map((kw, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-2 font-medium">{kw.keyword}</td>
                      <td className="py-2">{kw.searchVolume.toLocaleString()}</td>
                      <td className="py-2">{kw.difficulty}</td>
                      <td className="py-2">{kw.intent}</td>
                      <td className="py-2">
                        {(() => {
                          const measured = rankings[selectedCampaign.id]?.[kw.keyword];
                          if (measured) {
                            return (
                              <span
                                className="font-medium text-green-600"
                                title={`Measured via Search Console (${measured.impressions} impressions, ${measured.clicks} clicks)`}
                              >
                                #{measured.position}
                              </span>
                            );
                          }
                          return kw.currentRanking != null ? `#${kw.currentRanking}` : "—";
                        })()}
                      </td>
                      <td className="py-2">#{kw.targetRanking}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {/* Content Calendar */}
        {cj.contentCalendar?.length > 0 && (
          <Card className="p-6">
            <h2 className="text-lg font-semibold mb-4">Content Calendar</h2>
            <div className="space-y-6">
              {cj.contentCalendar.map((month) => (
                <div key={month.month} className="border rounded-lg p-4">
                  <h3 className="font-semibold text-sm mb-1">Month {month.month}: {month.focusArea}</h3>
                  <p className="text-xs text-muted-foreground mb-3">{month.expectedOutcomes}</p>
                  {month.contentPieces?.length > 0 && (
                    <ul className="space-y-2">
                      {month.contentPieces.map((piece, i) => (
                        <li key={i} className="text-sm flex items-start gap-2">
                          <span className="text-primary mt-0.5">•</span>
                          <div>
                            <span className="font-medium">{piece.title}</span>
                            <span className="text-xs text-muted-foreground ml-2">({piece.type}, {piece.estimatedWordCount} words)</span>
                            <p className="text-xs text-muted-foreground">{piece.description}</p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Competitor Analysis */}
        {competitors.length > 0 && (
          <Card className="p-6">
            <h2 className="text-lg font-semibold mb-4">Competitor Analysis</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {competitors.map((comp, i) => {
                const compScores = [
                  { label: "SEO", v: comp.seoScore },
                  { label: "AEO", v: comp.aeoScore },
                  { label: "GEO", v: comp.geoScore },
                ];
                return (
                  <div key={i} className="p-4 rounded-lg border">
                    <h4 className="font-medium text-sm mb-2 text-primary">
                      {comp.competitorUrl?.replace(/^https?:\/\//, "")}
                    </h4>
                    {comp.crawled !== false && compScores.some((s) => s.v != null) && (
                      <div className="mb-2 flex items-center gap-3 text-xs">
                        {compScores.map((s) => (
                          <span key={s.label} className="flex items-baseline gap-1">
                            <span className="text-muted-foreground uppercase tracking-wide">{s.label}</span>
                            <span className={`font-bold ${s.v == null ? "text-muted-foreground" : s.v >= 81 ? "text-green-600" : s.v >= 50 ? "text-yellow-600" : "text-red-600"}`}>
                              {s.v ?? "—"}
                            </span>
                          </span>
                        ))}
                        {comp.competitorWordCount != null && (
                          <span className="text-muted-foreground">· {comp.competitorWordCount.toLocaleString()} words</span>
                        )}
                      </div>
                    )}
                    {comp.strengths?.length > 0 && (
                      <div className="mb-2">
                        <span className="text-xs font-medium text-green-600">Strengths:</span>
                        <ul className="text-xs text-muted-foreground mt-1 space-y-0.5">
                          {comp.strengths.slice(0, 3).map((s, j) => (
                            <li key={j}>✓ {s}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {comp.weaknesses?.length > 0 && (
                      <div className="mb-2">
                        <span className="text-xs font-medium text-red-600">Weaknesses:</span>
                        <ul className="text-xs text-muted-foreground mt-1 space-y-0.5">
                          {comp.weaknesses.slice(0, 3).map((w, j) => (
                            <li key={j}>✗ {w}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground italic">{comp.contentStrategy}</p>
                  </div>
                );
              })}
              <p className="text-xs text-muted-foreground italic">
                Competitor SEO / AEO / GEO scores are computed from each site's homepage by the same
                scoring engine used for this audit — equal-terms benchmarking.
              </p>
            </div>
          </Card>
        )}

        {/* Social presence research (AI-assisted estimates) */}
        {socialResearch && (socialResearch.brands?.length > 0 || socialResearch.overall) && (
          <Card className="p-6">
            <h2 className="text-lg font-semibold mb-2">Social Presence Research</h2>
            <p className="text-xs text-muted-foreground italic mb-4">
              AI-assisted estimates from public profiles — verify before relying on them.
            </p>
            {socialResearch.overall && (
              <p className="text-sm text-muted-foreground mb-4">{socialResearch.overall}</p>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {(socialResearch.brands ?? []).map((b, i) => (
                <div key={i} className="p-4 rounded-lg border">
                  <h4 className="font-medium text-sm mb-2 text-primary">{b.name}</h4>
                  {(b.platforms ?? []).length > 0 ? (
                    <ul className="space-y-1.5">
                      {(b.platforms ?? []).map((p, j) => (
                        <li key={j} className="text-xs text-muted-foreground flex items-start gap-2">
                          <span className={p.active ? "text-green-600 font-medium" : "text-gray-400"}>
                            {p.active ? "●" : "○"} {p.platform}
                          </span>
                          {p.notes && <span className="flex-1">— {p.notes}</span>}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-muted-foreground">No platforms detected.</p>
                  )}
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Deliverables */}
        {cj.deliverables && cj.deliverables.length > 0 && (
          <Card className="p-6">
            <h2 className="text-lg font-semibold mb-4">Deliverables</h2>
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {cj.deliverables.map((d, i) => (
                <li key={i} className="text-sm flex items-start gap-2">
                  <span className="text-green-500 mt-0.5">✓</span>
                  {d}
                </li>
              ))}
            </ul>
          </Card>
        )}

        {/* ROI */}
        {cj.estimatedROI && (
          <Card className="p-6">
            <h2 className="text-lg font-semibold mb-3">Projected ROI (estimate)</h2>
            <p className="text-sm text-muted-foreground">{cj.estimatedROI}</p>
            <p className="text-xs text-muted-foreground mt-3 italic">
              This projection is generated from industry benchmarks and the website audit — it is an
              estimate, not a guarantee of results.
            </p>
          </Card>
        )}

        {/* Questions note */}
        <p className="text-center text-sm text-muted-foreground">
          Questions about this proposal? Contact your agency representative for a custom consultation.
        </p>
      </div>
    </div>
  );
}

// ============================================================================
// Competitor Benchmark — the same-engine SEO / AEO / GEO scores the agency's
// audit ran on each competitor, shown on the proposal so the client sees how
// they stack up. Always renders (with an honest empty state) so it can never
// silently disappear.
// ============================================================================

function CompetitorBenchmark({ competitors }: { competitors: CompetitorData[] }) {
  const lastScored = competitors.reduce<string | null>((latest, c) => {
    return c.scoredAt && (!latest || c.scoredAt > latest) ? c.scoredAt : latest;
  }, null);

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-4">
        <h2 className="text-lg font-semibold">Competitor Benchmark</h2>
        {lastScored && (
          <span className="text-xs text-muted-foreground">
            Last benchmarked {new Date(lastScored).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </span>
        )}
      </div>
      {competitors.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No competitors were benchmarked for this audit yet. Your agency can add
          up to three competitors and re-run the audit to include a head-to-head
          SEO / AEO / GEO comparison in this proposal.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Competitor</th>
                  <th className="py-2 pr-4 font-medium">SEO</th>
                  <th className="py-2 pr-4 font-medium">AEO</th>
                  <th className="py-2 pr-4 font-medium">GEO</th>
                  <th className="py-2 font-medium">Words</th>
                </tr>
              </thead>
              <tbody>
                {competitors.map((c, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-2 pr-4 font-medium">
                      {c.competitorUrl?.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                    </td>
                    {["seoScore", "aeoScore", "geoScore"].map((k) => {
                      const v = c[k as keyof CompetitorData] as number | null | undefined;
                      return (
                        <td key={k} className="py-2 pr-4">
                          {c.crawled === false || v == null ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <span className={`font-bold ${v >= 81 ? "text-green-600" : v >= 50 ? "text-yellow-600" : "text-red-600"}`}>
                              {v}
                            </span>
                          )}
                        </td>
                      );
                    })}
                    <td className="py-2 text-muted-foreground">
                      {c.competitorWordCount != null ? c.competitorWordCount.toLocaleString() : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground italic mt-3">
            Competitor scores use the same scoring engine as your website audit
            (SEO, AEO, GEO) and refresh automatically each month.
          </p>
        </>
      )}
    </Card>
  );
}