"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Trash2 } from "lucide-react";

// ============================================================================
// Types
// ============================================================================

interface AuditSummary {
  url: string;
  overallScore: number;
  technicalIssues: number;
  onPageIssues: number;
}

interface AuditIssue {
  severity: "high" | "medium" | "low";
  description: string;
}

interface AuditJson {
  url: string;
  overallScore: number;
  scannedAt?: string;
  homepage?: {
    title: string;
    metaDescription: string;
    wordCount: number;
    loadTimeMs: number | null;
    statusCode: number | null;
    h1: string[];
    h2: string[];
    images?: { hasAlt: boolean; src: string }[];
    internalLinks?: { href: string; text: string }[];
  };
  technicalIssues: AuditIssue[];
  onPageIssues: AuditIssue[];
  contentGaps: string[];
  pageSpeedScore: number | null;
  internalPages?: { url: string; title: string }[];
  siteStructure?: { pages: { url: string; title: string; depth: number }[]; totalInternalLinks: number; maxDepth: number };
}

interface CompetitorData {
  competitorUrl: string;
  strengths: string[];
  weaknesses: string[];
  topKeywords: string[];
  contentStrategy: string;
}

interface StoredCampaign {
  id: string;
  tenant_id: string;
  client_id: string;
  url: string;
  tier_name: string;
  tier_price: number;
  status: string;
  campaign_json: CampaignJson;
  audit_json: AuditJson;
  competitors_json: CompetitorData[];
  created_at: string;
  created_by: string | null;
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
      estimatedWordCount?: number;
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
    linkBuildingApproach: string;
    targetDomains: string[];
    contentMarketingChannels: string[];
    socialMediaStrategy: string;
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
  estimatedROI: string;
  differentiators: string[];
}

interface CampaignResponse {
  success: boolean;
  audit: AuditSummary | null;
  competitors: string[];
  campaigns: StoredCampaign[];
}

// ============================================================================
// Helpers
// ============================================================================

const severityColors: Record<string, string> = {
  high: "text-red-600 bg-red-50 dark:text-red-400 dark:bg-red-950",
  medium: "text-yellow-600 bg-yellow-50 dark:text-yellow-400 dark:bg-yellow-950",
  low: "text-blue-600 bg-blue-50 dark:text-blue-400 dark:bg-blue-950",
};

const difficultyLabels: Record<string, string> = {
  low: "Easy",
  medium: "Moderate",
  high: "Hard",
};

const intentLabels: Record<string, string> = {
  informational: "Info",
  commercial: "Commercial",
  transactional: "Buy",
  navigational: "Nav",
};

// ============================================================================
// Page Component
// ============================================================================

interface ClientOption {
  id: string;
  name: string;
  website: string | null;
}

export default function SeoCampaignsPage() {
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [customClientName, setCustomClientName] = useState("");
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingClients, setLoadingClients] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<StoredCampaign[]>([]);
  const [audit, setAudit] = useState<AuditSummary | null>(null);
  const [competitors, setCompetitors] = useState<string[]>([]);
  const [editingTier, setEditingTier] = useState<StoredCampaign | null>(null);
  const [editForm, setEditForm] = useState<string>("");
  const [presented, setPresented] = useState(false);
  const [expandedCampaign, setExpandedCampaign] = useState<string | null>(null);
  const [expandedAudit, setExpandedAudit] = useState(false);
  const [pastCampaigns, setPastCampaigns] = useState<StoredCampaign[]>([]);
  const [loadingPast, setLoadingPast] = useState(true);

  // Fetch clients on mount
  useEffect(() => {
    async function loadClients() {
      try {
        const res = await fetch("/api/clients", { credentials: "include" });
        if (res.ok) {
          const data = await res.json();
          setClients(data.clients ?? []);
        }
      } catch {
        // ignore
      } finally {
        setLoadingClients(false);
      }
    }
    loadClients();
  }, []);

  // Fetch past campaigns
  useEffect(() => {
    async function loadPast() {
      try {
        const res = await fetch("/api/seo/campaigns", { credentials: "include" });
        if (res.ok) {
          const data = await res.json();
          setPastCampaigns(data.campaigns ?? []);
        }
      } catch {
        // ignore
      } finally {
        setLoadingPast(false);
      }
    }
    loadPast();
  }, []);

  // Auto-fill URL when client selection changes
  const handleClientSelect = (selectedId: string) => {
    setSelectedClientId(selectedId);
    if (selectedId) {
      const selected = clients.find((c) => c.id === selectedId);
      if (selected?.website && !url) {
        setUrl(selected.website);
      }
    }
  };

  // ------------------------------------------------------------------
  // Generate new campaigns
  // ------------------------------------------------------------------
  const isValidUrl = (u: string) => {
    try {
      const parsed = new URL(u.startsWith("http") ? u : `https://${u}`);
      return parsed.hostname.includes(".");
    } catch {
      return false;
    }
  };

  const handleGenerate = async () => {
    const clientIdentifier = selectedClientId || customClientName.trim();
    if (!clientIdentifier || !url.trim()) {
      setError("Please select a client or enter a client name, and provide a website URL.");
      return;
    }

    const normalizedUrl = url.trim().startsWith("http") ? url.trim() : `https://${url.trim()}`;
    if (!isValidUrl(normalizedUrl)) {
      setError("Please enter a valid website URL (e.g., https://example.com).");
      return;
    }

    setLoading(true);
    setError(null);
    setAudit(null);
    setCompetitors([]);
    setCampaigns([]);

    try {
      const payload: Record<string, string> = { url: url.trim() };
      if (selectedClientId) {
        payload.clientId = selectedClientId;
      } else {
        payload.clientName = customClientName.trim();
      }
      const res = await fetch("/api/seo/generate-campaign", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data: CampaignResponse & { error?: string; details?: string } =
        await res.json();

      if (!res.ok) {
        setError(data.error ?? data.details ?? "Failed to generate campaigns");
        return;
      }

      if (data.audit) setAudit(data.audit);
      if (data.competitors) setCompetitors(data.competitors);
      if (data.campaigns) setCampaigns(data.campaigns);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "An unexpected error occurred"
      );
    } finally {
      setLoading(false);
    }
  };

  // ------------------------------------------------------------------
  // Present to Client
  // ------------------------------------------------------------------
  const handlePresentToClient = () => {
    setPresented(true);
  };

  // Delete campaign
  const handleDeleteCampaign = useCallback(async (campaignId: string, tierName: string) => {
    if (!confirm("Delete this campaign (" + tierName + ")? This cannot be undone.")) return;
    try {
      const res = await fetch("/api/seo/campaigns/" + campaignId, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) {
        setPastCampaigns((prev) => prev.filter((c) => c.id !== campaignId));
        setCampaigns((prev) => prev.filter((c) => c.id !== campaignId));
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Failed to delete campaign");
      }
    } catch {
      setError("Network error while deleting campaign");
    }
  }, []);

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">SEO Audits & Proposals</h1>
          <p className="text-muted-foreground mt-1">
            Run website audits, discover competitors, and generate customized tiered proposals for your clients.
          </p>
        </div>
      </div>

      {/* New Campaign Form */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold mb-4">New Audit</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label
              htmlFor="clientId"
              className="block text-sm font-medium mb-1.5"
            >
              Client
            </label>
            {loadingClients ? (
              <div className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-muted-foreground">
                Loading clients...
              </div>
            ) : (
              <>
                <select
                  id="clientSelect"
                  value={selectedClientId}
                  onChange={(e) => handleClientSelect(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring mb-2"
                >
                  <option value="">Select an existing client...</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}{c.website ? ` (${c.website})` : ""}
                    </option>
                  ))}
                </select>
                {!selectedClientId && (
                  <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t" />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-card px-2 text-muted-foreground">or enter new client name</span>
                    </div>
                  </div>
                )}
                {!selectedClientId && (
                  <input
                    id="clientName"
                    type="text"
                    placeholder="e.g., Giantbyte or GB1"
                    value={customClientName}
                    onChange={(e) => setCustomClientName(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring mt-2"
                  />
                )}
              </>
            )}
          </div>
          <div>
            <label
              htmlFor="url"
              className="block text-sm font-medium mb-1.5"
            >
              Website URL
            </label>
            <input
              id="url"
              type="text"
              placeholder="https://example.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>

        {error && (
          <div className="mt-4 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
            {error}
          </div>
        )}

        <Button
          onClick={handleGenerate}
          disabled={loading}
          className="mt-4"
        >
          {loading ? (
            <>
              <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-background border-t-transparent" />
              Crawling & Generating...
            </>
          ) : (
            "Run Audit & Generate Proposals"
          )}
        </Button>
      </Card>

      {/* Audit Summary */}
      {audit && (
        <Card className="p-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Site Audit Summary</h2>
            <Button variant="ghost" size="sm" onClick={() => setExpandedAudit(!expandedAudit)}>
              {expandedAudit ? "Collapse" : "View Full Audit"}
            </Button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">URL:</span>{" "}
              <span className="font-medium">{audit.url}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Overall Score:</span>{" "}
              <span
                className={`font-bold ${
                  audit.overallScore >= 80
                    ? "text-green-500"
                    : audit.overallScore >= 50
                    ? "text-yellow-500"
                    : "text-red-500"
                }`}
              >
                {audit.overallScore}/100
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Technical Issues:</span>{" "}
              <span className="font-medium">{audit.technicalIssues}</span>
            </div>
            <div>
              <span className="text-muted-foreground">On-Page Issues:</span>{" "}
              <span className="font-medium">{audit.onPageIssues}</span>
            </div>
          </div>
          {competitors.length > 0 && (
            <div className="mt-3 text-sm">
              <span className="text-muted-foreground">Competitors: </span>
              <span>{competitors.join(", ")}</span>
            </div>
          )}

          {/* Expanded audit details from the first campaign's audit_json */}
          {expandedAudit && campaigns.length > 0 && campaigns[0].audit_json && (
            <AuditDetails audit={campaigns[0].audit_json} competitors={campaigns[0].competitors_json} />
          )}
        </Card>
      )}

      {/* Campaign Tiers (Pricing Table Style) */}
      {campaigns.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">
              Generated Campaign Tiers
            </h2>
            <Button
              variant="outline"
              onClick={handlePresentToClient}
              disabled={presented}
            >
              {presented ? "Ready to Share ✓" : "Share with Client"}
            </Button>
          </div>

          {presented && (
            <div className="mb-4 p-4 rounded-md bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 space-y-3">
              <p className="text-green-700 dark:text-green-300 text-sm font-medium">
                ✅ Proposal ready! Share this link with your client:
              </p>
              {campaigns.length > 0 && campaigns[0].client_id && (
                <div className="space-y-2">
                  <code className="block p-2 bg-green-100 dark:bg-green-900 rounded text-xs break-all font-mono text-green-800 dark:text-green-200">
                    {window.location.origin}/seo/proposal?clientId={campaigns[0].client_id}
                  </code>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-green-300 dark:border-green-700"
                    onClick={() => {
                      const link = `${window.location.origin}/seo/proposal?clientId=${campaigns[0].client_id}`;
                      navigator.clipboard.writeText(link).then(() => alert("Link copied!"));
                    }}
                  >
                    📋 Copy Link
                  </Button>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {campaigns.map((campaign) => {
              const cj = campaign.campaign_json;
              const contentCount =
                cj.contentCalendar?.reduce(
                  (sum, m) => sum + (m.contentPieces?.length ?? 0),
                  0
                ) ?? 0;

              const isExpanded = expandedCampaign === campaign.id;

              return (
                <Card
                  key={campaign.id}
                  className={`p-6 flex flex-col ${
                    campaign.tier_name?.includes("Gold") || campaign.tier_name?.includes("Custom")
                      ? "ring-2 ring-primary"
                      : ""
                  } ${isExpanded ? "md:col-span-3 lg:col-span-4" : ""}`}
                >
                  {/* Tier Badge */}
                  <div className="text-center mb-4">
                    <span
                      className={`inline-block px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wide ${
                        campaign.tier_name?.includes("Gold") || campaign.tier_name?.includes("Custom")
                          ? "bg-primary text-primary-foreground"
                          : campaign.tier_name?.includes("Silver")
                          ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200"
                          : campaign.tier_name?.includes("Bronze")
                          ? "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200"
                          : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200"
                      }`}
                    >
                      {cj.tierName || campaign.tier_name}
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
                        <span className="text-muted-foreground text-sm">
                          /month
                        </span>
                      </>
                    )}
                  </div>

                  {/* Summary */}
                  <p className="text-sm text-muted-foreground text-center mb-4">
                    {cj.executiveSummary}
                  </p>

                  {!isExpanded && (
                    <>
                      {/* Stats */}
                      <div className="space-y-2 mb-4 flex-1">
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Keywords:</span>
                          <span className="font-medium">
                            {cj.targetKeywords?.length ?? 0}
                          </span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Content Pieces:</span>
                          <span className="font-medium">{contentCount}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Tech Tasks:</span>
                          <span className="font-medium">
                            {cj.contentCalendar?.reduce(
                              (sum, m) => sum + (m.technicalTasks?.length ?? 0),
                              0
                            ) ?? 0}
                          </span>
                        </div>
                        {cj.deliverables && cj.deliverables.length > 0 && (
                          <div className="mt-3">
                            <span className="text-xs font-semibold uppercase text-muted-foreground">
                              Deliverables
                            </span>
                            <ul className="mt-1 space-y-1">
                              {cj.deliverables.slice(0, 5).map((d, i) => (
                                <li
                                  key={i}
                                  className="text-xs text-muted-foreground flex items-start gap-1.5"
                                >
                                  <span className="text-green-500 mt-0.5">✓</span>
                                  {d}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex gap-2 mt-auto pt-4 border-t">
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1"
                          onClick={() => setExpandedCampaign(campaign.id)}
                        >
                          View Details
                        </Button>
                      </div>
                    </>
                  )}

                  {/* Expanded detailed view */}
                  {isExpanded && (
                    <div className="mt-4 border-t pt-4 space-y-6">
                      <div className="flex justify-end">
                        <Button variant="ghost" size="sm" onClick={() => setExpandedCampaign(null)}>
                          Collapse
                        </Button>
                      </div>
                      <CampaignDetails campaign={campaign} />
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Past Campaigns */}
      {!loadingPast && pastCampaigns.length > 0 && (
        <Card className="p-6">
          <h2 className="text-lg font-semibold mb-4">Past Campaigns</h2>
          <div className="space-y-2">
            {pastCampaigns.slice(0, 10).map((pc) => (
              <div
                key={pc.id}
                className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/30 cursor-pointer group/camp"
                onClick={() => {
                  setExpandedCampaign(expandedCampaign === pc.id ? null : pc.id);
                  if (!campaigns.find(c => c.id === pc.id)) {
                    setCampaigns(prev => [...prev, pc]);
                  }
                }}
              >
                <div>
                  <span className="font-medium text-sm">{pc.url.replace(/^https?:\/\//, "").replace(/^www\./, "")}</span>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-muted-foreground">{pc.tier_name}</span>
                    <span className="text-xs text-muted-foreground">•</span>
                    {pc.tier_price == null || pc.tier_price === 0 || String(pc.tier_name ?? "").toLowerCase().includes("custom") ? (<span className="text-xs text-primary font-medium">Custom Consult Required</span>) : (<span className="text-xs text-muted-foreground">${pc.tier_price.toLocaleString()}/mo</span>)}
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full capitalize ${
                      pc.status === "proposed" ? "bg-blue-100 text-blue-700" : "bg-green-100 text-green-700"
                    }`}>{pc.status}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-muted-foreground">
                    {new Date(pc.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteCampaign(pc.id, pc.tier_name); }}
                    className="p-1.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-muted-foreground hover:text-red-600 transition-colors"
                    title="Delete campaign"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

// ============================================================================
// Audit Details Component
// ============================================================================

function AuditDetails({ audit, competitors }: { audit: AuditJson; competitors: CompetitorData[] }) {
  return (
    <div className="mt-6 space-y-6 border-t pt-4">
      {/* Score breakdown */}
      <div>
        <h3 className="text-md font-semibold mb-2">Score Breakdown</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          {audit.pageSpeedScore != null && (
            <div className="p-3 rounded-lg bg-muted">
              <span className="text-muted-foreground">Page Speed</span>
              <span className={`block text-lg font-bold ${audit.pageSpeedScore >= 75 ? "text-green-500" : audit.pageSpeedScore >= 50 ? "text-yellow-500" : "text-red-500"}`}>
                {audit.pageSpeedScore}/100
              </span>
            </div>
          )}
          {audit.homepage && (
            <>
              <div className="p-3 rounded-lg bg-muted">
                <span className="text-muted-foreground">Word Count</span>
                <span className="block text-lg font-bold">{audit.homepage.wordCount}</span>
              </div>
              <div className="p-3 rounded-lg bg-muted">
                <span className="text-muted-foreground">Load Time</span>
                <span className="block text-lg font-bold">
                  {audit.homepage.loadTimeMs != null ? `${(audit.homepage.loadTimeMs / 1000).toFixed(1)}s` : "N/A"}
                </span>
              </div>
              <div className="p-3 rounded-lg bg-muted">
                <span className="text-muted-foreground">Pages Crawled</span>
                <span className="block text-lg font-bold">
                  {(audit.internalPages?.length ?? 0) + 1}
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Technical Issues */}
      {audit.technicalIssues.length > 0 && (
        <div>
          <h3 className="text-md font-semibold mb-2">Technical Issues Found</h3>
          <div className="space-y-2">
            {audit.technicalIssues.map((issue, i) => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-lg border text-sm">
                <span className={`px-2 py-0.5 rounded text-xs font-semibold uppercase mt-0.5 ${severityColors[issue.severity]}`}>
                  {issue.severity}
                </span>
                <span>{issue.description}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* On-Page Issues */}
      {audit.onPageIssues.length > 0 && (
        <div>
          <h3 className="text-md font-semibold mb-2">On-Page Issues Found</h3>
          <div className="space-y-2">
            {audit.onPageIssues.map((issue, i) => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-lg border text-sm">
                <span className={`px-2 py-0.5 rounded text-xs font-semibold uppercase mt-0.5 ${severityColors[issue.severity]}`}>
                  {issue.severity}
                </span>
                <span>{issue.description}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Content Gaps */}
      {audit.contentGaps.length > 0 && (
        <div>
          <h3 className="text-md font-semibold mb-2">Content Gaps & Opportunities</h3>
          <ul className="space-y-1">
            {audit.contentGaps.map((gap, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                <span className="text-green-500 mt-0.5">→</span>
                {gap}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Competitor Analysis */}
      {competitors.length > 0 && (
        <div>
          <h3 className="text-md font-semibold mb-2">Competitor Analysis</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {competitors.map((comp, i) => (
              <div key={i} className="p-4 rounded-lg border">
                <h4 className="font-medium text-sm mb-2 text-primary">{comp.competitorUrl?.replace(/^https?:\/\//, "")}</h4>
                {comp.strengths?.length > 0 && (
                  <div className="mb-2">
                    <span className="text-xs font-semibold text-green-600">Strengths</span>
                    <ul className="mt-1 space-y-0.5">
                      {comp.strengths.slice(0, 3).map((s, j) => (
                        <li key={j} className="text-xs text-muted-foreground flex gap-1">
                          <span className="text-green-500">+</span> {s}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {comp.weaknesses?.length > 0 && (
                  <div>
                    <span className="text-xs font-semibold text-red-600">Weaknesses</span>
                    <ul className="mt-1 space-y-0.5">
                      {comp.weaknesses.slice(0, 3).map((w, j) => (
                        <li key={j} className="text-xs text-muted-foreground flex gap-1">
                          <span className="text-red-500">-</span> {w}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Campaign Details Component (expanded view)
// ============================================================================

function CampaignDetails({ campaign }: { campaign: StoredCampaign }) {
  const cj = campaign.campaign_json;

  return (
    <div className="space-y-6">
      {/* ROI & Differentiators */}
      <div className="flex flex-wrap gap-3">
        {cj.estimatedROI && (
          <div className="px-4 py-2 rounded-lg bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 text-sm">
            <span className="font-semibold">Projected ROI (est.):</span> {cj.estimatedROI}
          </div>
        )}
        {cj.differentiators?.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {cj.differentiators.map((d, i) => (
              <span key={i} className="px-2 py-1 rounded-full bg-purple-50 dark:bg-purple-950 text-purple-700 dark:text-purple-300 text-xs font-medium">
                {d}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Deliverables */}
      {cj.deliverables && cj.deliverables.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-2">Monthly Deliverables</h3>
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-1">
            {cj.deliverables.map((d, i) => (
              <li key={i} className="text-sm text-muted-foreground flex items-center gap-2">
                <span className="text-green-500">✓</span> {d}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Target Keywords */}
      {cj.targetKeywords?.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-2">Target Keywords ({cj.targetKeywords.length})</h3>
          <p className="text-xs text-muted-foreground mb-2">
            Volume and difficulty are AI estimates — verify with a keyword tool before presenting to the client.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Keyword</th>
                  <th className="py-2 pr-4 font-medium">Volume (est.)</th>
                  <th className="py-2 pr-4 font-medium">Difficulty (est.)</th>
                  <th className="py-2 pr-4 font-medium">Intent</th>
                  <th className="py-2 pr-4 font-medium">Target Rank</th>
                </tr>
              </thead>
              <tbody>
                {cj.targetKeywords.map((kw, i) => (
                  <tr key={i} className="border-b border-muted">
                    <td className="py-2 pr-4 font-medium">{kw.keyword}</td>
                    <td className="py-2 pr-4">{kw.searchVolume?.toLocaleString() ?? "-"}</td>
                    <td className="py-2 pr-4">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        kw.difficulty === "low" ? "bg-green-100 text-green-700" :
                        kw.difficulty === "medium" ? "bg-yellow-100 text-yellow-700" :
                        "bg-red-100 text-red-700"
                      }`}>
                        {difficultyLabels[kw.difficulty] ?? kw.difficulty}
                      </span>
                    </td>
                    <td className="py-2 pr-4">
                      <span className="text-xs bg-muted px-1.5 py-0.5 rounded">
                        {intentLabels[kw.intent] ?? kw.intent}
                      </span>
                    </td>
                    <td className="py-2">#{kw.targetRanking}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Content Calendar */}
      {cj.contentCalendar?.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-2">Content Calendar</h3>
          <div className="space-y-3">
            {cj.contentCalendar.map((month, i) => (
              <div key={i} className="p-4 rounded-lg border">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm font-semibold">Month {month.month}</span>
                  <span className="text-xs text-muted-foreground">—</span>
                  <span className="text-sm text-muted-foreground">{month.focusArea}</span>
                </div>

                {/* Content pieces */}
                {month.contentPieces?.length > 0 && (
                  <div className="mb-3">
                    <span className="text-xs font-semibold uppercase text-muted-foreground">Content</span>
                    <div className="mt-1 space-y-1">
                      {month.contentPieces.map((piece, j) => (
                        <div key={j} className="flex items-start gap-2 text-sm ml-2">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase mt-0.5 ${
                            piece.priority === "high" ? "bg-red-100 text-red-700" :
                            piece.priority === "medium" ? "bg-yellow-100 text-yellow-700" :
                            "bg-blue-100 text-blue-700"
                          }`}>
                            {piece.priority}
                          </span>
                          <div>
                            <span className="font-medium">{piece.title}</span>
                            <span className="text-xs text-muted-foreground ml-1">({piece.type})</span>
                            {piece.estimatedWordCount && (
                              <span className="text-xs text-muted-foreground ml-1">~{piece.estimatedWordCount} words</span>
                            )}
                            <p className="text-xs text-muted-foreground mt-0.5">{piece.description}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Technical tasks */}
                {month.technicalTasks?.length > 0 && (
                  <div className="mb-2">
                    <span className="text-xs font-semibold uppercase text-blue-600">Technical Tasks</span>
                    <ul className="mt-1 space-y-0.5 ml-2">
                      {month.technicalTasks.map((t, j) => (
                        <li key={j} className="text-sm text-muted-foreground flex gap-1.5">
                          <span className="text-blue-500">⚙</span> {t}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Link building */}
                {month.linkBuildingTasks?.length > 0 && (
                  <div className="mb-2">
                    <span className="text-xs font-semibold uppercase text-green-600">Link Building</span>
                    <ul className="mt-1 space-y-0.5 ml-2">
                      {month.linkBuildingTasks.map((t, j) => (
                        <li key={j} className="text-sm text-muted-foreground flex gap-1.5">
                          <span className="text-green-500">🔗</span> {t}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Expected outcomes */}
                {month.expectedOutcomes && (
                  <p className="text-xs text-muted-foreground italic mt-1">
                    Expected: {month.expectedOutcomes}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Technical Recommendations */}
      {cj.technicalRecommendations && cj.technicalRecommendations.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-2">Technical Recommendations</h3>
          <div className="space-y-2">
            {cj.technicalRecommendations.map((rec, i) => (
              <div key={i} className="p-3 rounded-lg border text-sm">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-semibold uppercase text-muted-foreground">{rec.category}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${severityColors[rec.priority]}`}>
                    {rec.priority}
                  </span>
                </div>
                <p className="font-medium">{rec.issue}</p>
                <p className="text-muted-foreground mt-0.5">{rec.solution}</p>
                {rec.estimatedImpact && (
                  <p className="text-xs text-green-600 mt-0.5">Impact: {rec.estimatedImpact}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* On-Page Optimizations */}
      {cj.onPageOptimizations && cj.onPageOptimizations.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-2">On-Page Optimizations</h3>
          <div className="space-y-2">
            {cj.onPageOptimizations.map((opt, i) => (
              <div key={i} className="p-3 rounded-lg border text-sm">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium">{opt.page}</span>
                  <span className="text-xs text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                    Target: {opt.targetKeyword}
                  </span>
                </div>
                <p className="text-muted-foreground">
                  <span className="text-yellow-600 font-medium">Current:</span> {opt.currentState}
                </p>
                <p className="text-green-600">
                  <span className="font-medium">Recommend:</span> {opt.recommendedChanges}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Off-Page Strategy */}
      {cj.offPageStrategy && (
        <div>
          <h3 className="text-sm font-semibold mb-2">Off-Page Strategy</h3>
          <div className="p-4 rounded-lg border space-y-3 text-sm">
            <p>{cj.offPageStrategy.summary}</p>
            {cj.offPageStrategy.linkBuildingApproach && (
              <div>
                <span className="font-medium">Link Building:</span>{" "}
                <span className="text-muted-foreground">{cj.offPageStrategy.linkBuildingApproach}</span>
              </div>
            )}
            {cj.offPageStrategy.targetDomains?.length > 0 && (
              <div>
                <span className="font-medium">Target Domains:</span>{" "}
                <span className="text-muted-foreground">{cj.offPageStrategy.targetDomains.join(", ")}</span>
              </div>
            )}
            {cj.offPageStrategy.contentMarketingChannels?.length > 0 && (
              <div>
                <span className="font-medium">Channels:</span>{" "}
                <span className="text-muted-foreground">{cj.offPageStrategy.contentMarketingChannels.join(", ")}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* KPIs & Metrics */}
      {cj.kpisAndMetrics && (
        <div>
          <h3 className="text-sm font-semibold mb-2">KPIs & Success Metrics</h3>
          <p className="text-xs text-muted-foreground mb-2">
            These are aspirational targets based on industry benchmarks — not guarantees of results.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div className="p-3 rounded-lg bg-muted">
              <span className="text-xs text-muted-foreground">Traffic Increase</span>
              <span className="block font-bold text-green-600">{cj.kpisAndMetrics.targetOrganicTrafficIncrease}</span>
            </div>
            <div className="p-3 rounded-lg bg-muted">
              <span className="text-xs text-muted-foreground">Keyword Improvement</span>
              <span className="block font-bold text-green-600">{cj.kpisAndMetrics.targetKeywordImprovements}</span>
            </div>
            <div className="p-3 rounded-lg bg-muted">
              <span className="text-xs text-muted-foreground">Conversion Rate</span>
              <span className="block font-bold text-green-600">{cj.kpisAndMetrics.targetConversionRate}</span>
            </div>
            <div className="p-3 rounded-lg bg-muted">
              <span className="text-xs text-muted-foreground">Domain Authority</span>
              <span className="block font-bold text-green-600">{cj.kpisAndMetrics.targetDomainAuthority}</span>
            </div>
          </div>
          {cj.kpisAndMetrics.additionalMetrics?.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {cj.kpisAndMetrics.additionalMetrics.map((m, i) => (
                <li key={i} className="text-xs text-muted-foreground flex gap-1.5">
                  <span className="text-green-500">•</span> {m}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Timeline */}
      {cj.timeline && cj.timeline.phases && cj.timeline.phases.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-2">
            Implementation Timeline ({cj.timeline.totalDuration})
          </h3>
          <div className="space-y-2">
            {cj.timeline.phases.map((phase, i) => (
              <div key={i} className="p-3 rounded-lg border text-sm">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold">{phase.phase}</span>
                  <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{phase.duration}</span>
                </div>
                <p className="text-muted-foreground">{phase.focus}</p>
                {phase.deliverables?.length > 0 && (
                  <ul className="mt-1 space-y-0.5 ml-2">
                    {phase.deliverables.map((d, j) => (
                      <li key={j} className="text-xs text-muted-foreground flex gap-1">
                        <span className="text-green-500">→</span> {d}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}