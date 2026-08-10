"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

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
  created_at: string;
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
  technicalRecommendations?: {
    category: string;
    issue: string;
    solution: string;
    priority: string;
    estimatedImpact: string;
  }[];
  onPageOptimizations?: {
    page: string;
    currentState: string;
    recommendedChanges: string;
    targetKeyword: string;
  }[];
  offPageStrategy?: {
    summary: string;
    [key: string]: unknown;
  };
  kpisAndMetrics?: {
    targetOrganicTrafficIncrease: string;
    targetKeywordImprovements: string;
    targetConversionRate: string;
    targetDomainAuthority: string;
    additionalMetrics: string[];
  };
  timeline?: {
    totalDuration: string;
    phases: {
      phase: string;
      duration: string;
      focus: string;
      deliverables: string[];
    }[];
  };
  deliverables?: string[];
  estimatedROI?: string;
  differentiators?: string[];
  [key: string]: unknown;
}

// ============================================================================
// Page Component
// ============================================================================

export default function SeoProposalPage() {
  const [campaigns, setCampaigns] = useState<StoredCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedTier, setExpandedTier] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [approvedId, setApprovedId] = useState<string | null>(null);
  const [deployResult, setDeployResult] = useState<{
    postsCreated: number;
    errors: string[];
  } | null>(null);

  // ------------------------------------------------------------------
  // Fetch proposed campaigns for this client
  // ------------------------------------------------------------------
  const fetchProposals = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/seo/client-proposals");

      if (!res.ok) {
        const errData = await res.json();
        setError(
          (errData as { error?: string }).error ?? "Failed to load proposals"
        );
        return;
      }

      const data = await res.json();
      const proposed =
        data.campaigns?.filter(
          (c: StoredCampaign) => c.status === "proposed"
        ) ?? [];
      setCampaigns(proposed);

      const approved = data.campaigns?.find(
        (c: StoredCampaign) => c.status === "approved" || c.status === "active"
      );
      if (approved) {
        setApprovedId(approved.id);
      }
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to load proposals"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProposals();
  }, [fetchProposals]);

  // ------------------------------------------------------------------
  // Approve a tier
  // ------------------------------------------------------------------
  const handleApprove = async (campaignId: string) => {
    setApprovingId(campaignId);
    setError(null);

    try {
      const res = await fetch(`/api/seo/campaigns/${campaignId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      const data = await res.json();

      if (!res.ok) {
        setError(
          (data as { error?: string }).error ?? "Failed to approve plan"
        );
        return;
      }

      setApprovedId(campaignId);
      setDeployResult({
        postsCreated: data.postsCreated ?? 0,
        errors: data.errors ?? [],
      });

      setCampaigns((prev) =>
        prev.map((c) =>
          c.id === campaignId
            ? { ...c, status: "approved" }
            : c
        )
      );
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to approve plan"
      );
    } finally {
      setApprovingId(null);
    }
  };

  // ------------------------------------------------------------------
  // Loading state
  // ------------------------------------------------------------------
  if (loading) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <div className="flex items-center justify-center min-h-[300px]">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <span className="ml-3 text-muted-foreground">
            Loading your proposal...
          </span>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Error state
  // ------------------------------------------------------------------
  if (error && campaigns.length === 0) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <Card className="p-12 text-center">
          <div className="text-4xl mb-4">🔍</div>
          <h2 className="text-xl font-semibold mb-2">
            No Proposals Available
          </h2>
          <p className="text-muted-foreground mb-4">{error}</p>
          <Button variant="outline" onClick={fetchProposals}>
            Try Again
          </Button>
        </Card>
      </div>
    );
  }

  // ------------------------------------------------------------------
  // No campaigns state
  // ------------------------------------------------------------------
  if (campaigns.length === 0) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <Card className="p-12 text-center">
          <div className="text-4xl mb-4">📋</div>
          <h2 className="text-xl font-semibold mb-2">
            No Active Proposals
          </h2>
          <p className="text-muted-foreground">
            Your agency has not yet shared any SEO audit or proposals with you.
            Once they do, you will be able to review and approve a tier here.
          </p>
        </Card>
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Success state after approval
  // ------------------------------------------------------------------
  if (approvedId && deployResult) {
    const approvedCampaign = campaigns.find((c) => c.id === approvedId);
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <Card className="p-8 text-center bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800">
          <div className="text-5xl mb-4">✅</div>
          <h2 className="text-2xl font-bold text-green-700 dark:text-green-300 mb-2">
            Plan Approved!
          </h2>
          <p className="text-muted-foreground mb-2">
            You selected the{" "}
            <strong>
              {approvedCampaign?.campaign_json?.tierName ?? "selected"}
            </strong>{" "}
            tier.
          </p>
          <p className="text-muted-foreground mb-4">
            <strong>{deployResult.postsCreated}</strong> content pieces have
            been scheduled and your plan is now active.
          </p>

          {deployResult.errors.length > 0 && (
            <div className="mt-4 p-3 rounded-md bg-yellow-50 dark:bg-yellow-950 text-yellow-700 dark:text-yellow-300 text-sm text-left">
              <p className="font-semibold mb-1">
                Some items could not be created:
              </p>
              <ul className="list-disc list-inside space-y-1">
                {deployResult.errors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-sm text-muted-foreground mt-4">
            Your agency will be in touch to begin onboarding and execution.
            Thank you for your trust!
          </p>
        </Card>

        {approvedCampaign && (
          <Card className="p-6">
            <h3 className="font-semibold text-lg mb-4">
              Your Approved Plan:{" "}
              {approvedCampaign.campaign_json.tierName}
            </h3>
            <p className="text-muted-foreground mb-4">
              {approvedCampaign.campaign_json.executiveSummary}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div>
                <span className="font-medium">Monthly Investment:</span> $
                {approvedCampaign.campaign_json.tierPrice.toLocaleString()}
              </div>
              <div>
                <span className="font-medium">Target Keywords:</span>{" "}
                {approvedCampaign.campaign_json.targetKeywords?.length ?? 0}
              </div>
              <div>
                <span className="font-medium">Content Pieces:</span>{" "}
                {approvedCampaign.campaign_json.contentCalendar?.reduce(
                  (sum, m) => sum + (m.contentPieces?.length ?? 0),
                  0
                ) ?? 0}
              </div>
              {(approvedCampaign.campaign_json as CampaignJson).estimatedROI && (
                <div>
                  <span className="font-medium">Projected ROI (est.):</span>{" "}
                  {approvedCampaign.campaign_json.estimatedROI}
                </div>
              )}
            </div>
          </Card>
        )}
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Main proposal comparison view
  // ------------------------------------------------------------------
  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-3xl font-bold tracking-tight mb-2">
          Your SEO Audit & Proposal
        </h1>
        <p className="text-muted-foreground max-w-2xl mx-auto">
          We have analyzed{" "}
          <strong>{campaigns[0]?.url ?? "your website"}</strong> and prepared
          the following tiered strategies. Choose the plan that best fits your
          goals and budget.
        </p>
      </div>

      {error && (
        <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm text-center">
          {error}
        </div>
      )}

      {/* Tier Comparison Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {campaigns.map((campaign) => {
          const cj = campaign.campaign_json;
          const tierLower = (cj.tierName ?? "").toLowerCase();
          const isGoldOrCustom =
            tierLower.includes("gold") || tierLower.includes("custom");
          const contentCount =
            cj.contentCalendar?.reduce(
              (sum, m) => sum + (m.contentPieces?.length ?? 0),
              0
            ) ?? 0;
          const isExpanded = expandedTier === campaign.id;

          return (
            <Card
              key={campaign.id}
              className={`p-6 flex flex-col transition-all ${
                isGoldOrCustom
                  ? "ring-2 ring-primary shadow-lg scale-[1.02]"
                  : ""
              }`}
            >
              {isGoldOrCustom && (
                <div className="text-center -mt-9 mb-3">
                  <span className="inline-block px-3 py-1 rounded-full text-xs font-semibold bg-primary text-primary-foreground">
                    Market Leader
                  </span>
                </div>
              )}

              {/* Tier Name */}
              <div className="text-center mb-4">
                <span
                  className={`inline-block px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wide ${
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
              </div>

              {/* Price */}
              <div className="text-center mb-2">
                {cj.tierPrice == null || String(cj.tierName ?? "").toLowerCase().includes("custom") ? (
                  <span className="text-base font-bold text-primary">Custom Consult Required</span>
                ) : (
                  <>
                    <span className="text-3xl font-bold">
                      ${cj.tierPrice.toLocaleString()}
                    </span>
                    <span className="text-muted-foreground text-sm">/month</span>
                  </>
                )}
              </div>

              {/* Executive Summary */}
              <p className="text-sm text-muted-foreground text-center mb-4 line-clamp-3">
                {cj.executiveSummary}
              </p>

              {/* Key metrics */}
              <div className="space-y-2 mb-4 flex-1">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Keywords:</span>
                  <span className="font-medium">
                    {cj.targetKeywords?.length ?? 0}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">
                    Content Pieces:
                  </span>
                  <span className="font-medium">{contentCount}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">
                    Technical Tasks:
                  </span>
                  <span className="font-medium">
                    {cj.contentCalendar?.reduce(
                      (sum, m) => sum + (m.technicalTasks?.length ?? 0),
                      0
                    ) ?? 0}
                  </span>
                </div>
                {cj.estimatedROI && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Projected ROI (est.):</span>
                    <span className="font-medium text-muted-foreground">
                      {cj.estimatedROI}
                    </span>
                  </div>
                )}

                {/* Deliverables list */}
                {cj.deliverables && cj.deliverables.length > 0 && (
                  <div className="mt-3 pt-3 border-t">
                    <span className="text-xs font-semibold uppercase text-muted-foreground">
                      What You Get
                    </span>
                    <ul className="mt-1.5 space-y-1">
                      {cj.deliverables.slice(0, isExpanded ? undefined : 6).map(
                        (d, i) => (
                          <li
                            key={i}
                            className="text-xs text-muted-foreground flex items-start gap-1.5"
                          >
                            <span className="text-green-500 mt-0.5 flex-shrink-0">
                              ✓
                            </span>
                            {d}
                          </li>
                        )
                      )}
                    </ul>
                    {cj.deliverables.length > 6 && !isExpanded && (
                      <button
                        onClick={() => setExpandedTier(campaign.id)}
                        className="text-xs text-primary hover:underline mt-1"
                      >
                        + {cj.deliverables.length - 6} more
                      </button>
                    )}
                  </div>
                )}

                {/* Expanded detail view */}
                {isExpanded && (
                  <div className="mt-3 pt-3 border-t space-y-3">
                    {cj.contentCalendar && cj.contentCalendar.length > 0 && (
                      <div>
                        <span className="text-xs font-semibold uppercase text-muted-foreground">
                          Content Calendar
                        </span>
                        {cj.contentCalendar.slice(0, 3).map((month, mi) => (
                          <div key={mi} className="mt-1.5 text-xs">
                            <span className="font-medium">
                              Month {month.month} — {month.focusArea}
                            </span>
                            <ul className="ml-3 mt-0.5 space-y-0.5">
                              {month.contentPieces?.slice(0, 3).map((p, pi) => (
                                <li key={pi} className="text-muted-foreground">
                                  • {p.title} ({p.priority})
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    )}

                    {cj.timeline && (
                      <div>
                        <span className="text-xs font-semibold uppercase text-muted-foreground">
                          Timeline
                        </span>
                        <p className="text-xs mt-0.5">
                          {cj.timeline.totalDuration}
                        </p>
                        {cj.timeline.phases?.slice(0, 2).map((phase, pi) => (
                          <p key={pi} className="text-xs ml-2 mt-0.5">
                            {phase.phase}: {phase.focus} ({phase.duration})
                          </p>
                        ))}
                      </div>
                    )}

                    <button
                      onClick={() => setExpandedTier(null)}
                      className="text-xs text-primary hover:underline"
                    >
                      Show less
                    </button>
                  </div>
                )}
              </div>

              {/* Approve Button */}
              <div className="mt-auto pt-4 border-t">
                <Button
                  className="w-full"
                  variant={isGoldOrCustom ? "default" : "outline"}
                  onClick={() => handleApprove(campaign.id)}
                  disabled={approvingId === campaign.id || !!approvedId}
                >
                  {approvingId === campaign.id ? (
                    <>
                      <span className="mr-2 h-3 w-3 animate-spin rounded-full border-2 border-background border-t-transparent" />
                      Processing...
                    </>
                  ) : (
                    `Select ${cj.tierName}`
                  )}
                </Button>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Footer info */}
      <div className="text-center text-sm text-muted-foreground">
        <p>
          Questions about these plans? Contact your agency representative
          for a custom consultation.
        </p>
      </div>
    </div>
  );
}