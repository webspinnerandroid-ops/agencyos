"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Trash2, Rocket, Loader2, Globe, FolderPlus, FileText, Puzzle, Wrench, FileSearch, RefreshCw } from "lucide-react";
import { WEBSITE_PLAN } from "@/lib/website-plan";

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
  seoScore?: number | null;
  aeoScore?: number | null;
  geoScore?: number | null;
  competitorWordCount?: number | null;
  crawled?: boolean;
  scoredAt?: string | null;
}

interface KeywordRank {
  position: number;
  impressions: number;
  clicks: number;
  query: string;
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
  location?: string | null;
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
  websitePlan?: {
    pages: string[];
    functions: string[];
    plugins: string[];
  } | null;
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
  const [location, setLocation] = useState("");
  const [competitorUrls, setCompetitorUrls] = useState<string[]>(["", "", ""]);
  const [loading, setLoading] = useState(false);
  const [loadingClients, setLoadingClients] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<StoredCampaign[]>([]);
  const [audit, setAudit] = useState<AuditSummary | null>(null);
  const [competitors, setCompetitors] = useState<string[]>([]);
  const [editingTier, setEditingTier] = useState<StoredCampaign | null>(null);
  const [editForm, setEditForm] = useState<string>("");
  const [presented, setPresented] = useState(false);
  const [showAuditLink, setShowAuditLink] = useState(false);
  const [expandedCampaign, setExpandedCampaign] = useState<string | null>(null);
  const [expandedAudit, setExpandedAudit] = useState(false);
  const [pastCampaigns, setPastCampaigns] = useState<StoredCampaign[]>([]);
  const [loadingPast, setLoadingPast] = useState(true);
  const [startingCampaignId, setStartingCampaignId] = useState<string | null>(null);
  const [sendingSigId, setSendingSigId] = useState<string | null>(null);
  const [sentSignLink, setSentSignLink] = useState<{
    campaignId: string;
    url: string;
  } | null>(null);
  const [startDialogCampaign, setStartDialogCampaign] = useState<string | null>(null);
  const [signDialogCampaign, setSignDialogCampaign] = useState<StoredCampaign | null>(null);
  const [signFormName, setSignFormName] = useState("");
  const [signFormEmail, setSignFormEmail] = useState("");
  const [signFormError, setSignFormError] = useState<string | null>(null);
  const [startIncludeWebsite, setStartIncludeWebsite] = useState(false);
  const [startCreateWorkspace, setStartCreateWorkspace] = useState(true);
  const [startBusy, setStartBusy] = useState(false);
  const [rerunningAuditId, setRerunningAuditId] = useState<string | null>(null);
  const [auditNotice, setAuditNotice] = useState<string | null>(null);
  // Measured GSC positions per campaign, keyed by target keyword.
  const [rankings, setRankings] = useState<
    Record<string, Record<string, KeywordRank>>
  >({});

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

  const fetchRankings = useCallback(async (campaignIds: string[]) => {
    const ids = Array.from(new Set(campaignIds.filter(Boolean)));
    if (ids.length === 0) return;
    const entries = await Promise.all(
      ids.map(async (id) => {
        try {
          const res = await fetch(`/api/seo/rankings?campaignId=${id}`, {
            credentials: "include",
          });
          if (!res.ok) return [id, {}] as const;
          const data = await res.json();
          return [id, data.rankings ?? {}] as const;
        } catch {
          return [id, {}] as const;
        }
      })
    );
    setRankings((prev) => {
      const next = { ...prev };
      for (const [id, r] of entries) next[id] = r;
      return next;
    });
  }, []);

  // Fetch past campaigns
  useEffect(() => {
    async function loadPast() {
      try {
        const res = await fetch("/api/seo/campaigns", { credentials: "include" });
        if (res.ok) {
          const data = await res.json();
          setPastCampaigns(data.campaigns ?? []);
          fetchRankings((data.campaigns ?? []).map((c: StoredCampaign) => c.id));

          // Deep link from the dashboard's Recent SEO Audits (?open=<id>):
          // load the audit into the tier grid and expand it so the agency can
          // start the campaign from that point.
          const openId = new URLSearchParams(window.location.search).get("open");
          if (openId) {
            const match = (data.campaigns ?? []).find((c: StoredCampaign) => c.id === openId);
            if (match) {
              setCampaigns((prev) =>
                prev.find((c) => c.id === openId) ? prev : [...prev, match]
              );
              setExpandedCampaign(openId);
            }
          }
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
      const payload: Record<string, unknown> = { url: url.trim() };
      if (location.trim()) {
        payload.location = location.trim();
      }
      if (selectedClientId) {
        payload.clientId = selectedClientId;
      } else {
        payload.clientName = customClientName.trim();
      }
      const manualCompetitors = competitorUrls
        .map((c) => c.trim())
        .filter(Boolean);
      if (manualCompetitors.length > 0) {
        payload.competitors = manualCompetitors;
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
      if (data.campaigns) {
        setCampaigns(data.campaigns);
        fetchRankings(data.campaigns.map((c: StoredCampaign) => c.id));
      }
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
  // Seed a dated campaign plan straight from this proposal tier (no LLM —
  // the proposal's content calendar is the blueprint). Lands on the Content
  // Calendar as proposed items. Opens a short setup dialog first so the
  // owner can choose whether a website build is part of the campaign and
  // whether to spin up a dedicated workspace.
  const startCampaign = useCallback(async (campaignId: string) => {
    setStartingCampaignId(campaignId);
    setStartBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/campaign-plans/from-proposal", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        // Auto-create a dedicated workspace for the campaign so its plan,
        // posts and chat stay isolated — falls back to the current workspace
        // if the license's workspace quota is reached.
        body: JSON.stringify({
          campaignId,
          createWorkspace: startCreateWorkspace,
          includeWebsite: startIncludeWebsite,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Failed to start campaign");
        setStartDialogCampaign(null);
        return;
      }
      setStartDialogCampaign(null);
      window.location.href = data.planUrl ?? "/dashboard/calendar";
    } catch {
      setError("Network error while starting campaign");
      setStartDialogCampaign(null);
    } finally {
      setStartingCampaignId(null);
      setStartBusy(false);
    }
  }, [startCreateWorkspace, startIncludeWebsite]);

  // ------------------------------------------------------------------
  // Re-run a past campaign's competitor benchmark scores (no LLM cost, no
  // client-site re-crawl — only the stored competitor URLs are re-scored).
  const handleRerunAudit = useCallback(async (campaignId: string) => {
    setRerunningAuditId(campaignId);
    setAuditNotice(null);
    try {
      const res = await fetch(`/api/seo/campaigns/${campaignId}/re-run-audit`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAuditNotice(data.error ?? "Failed to re-run audit");
        return;
      }
      const apply = (prev: StoredCampaign[]) =>
        prev.map((c) =>
          c.id === campaignId
            ? { ...c, competitors_json: data.competitors ?? c.competitors_json }
            : c
        );
      setCampaigns(apply);
      setPastCampaigns(apply);
      setAuditNotice(
        `Competitor benchmark refreshed — ${data.scored} scored, ${data.unreachable} unreachable.`
      );
    } catch {
      setAuditNotice("Network error while re-running audit");
    } finally {
      setRerunningAuditId(null);
    }
  }, []);

  // ------------------------------------------------------------------
  // Send a proposal for signature (in-house signing link). Emails the client
  // a secure /sign/[token] link and stores the same link so the agency can
  // copy/share it manually. Returns an error message on failure (null on
  // success) so the signing dialog can show it inline.
  const handleSendForSignature = useCallback(
    async (campaign: StoredCampaign, signerName?: string, signerEmail?: string) => {
      setSendingSigId(campaign.id);
      setError(null);
      try {
        const res = await fetch(`/api/seo/campaigns/${campaign.id}/sign-request`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            signerName: (signerName ?? campaign.signer_name ?? "").trim(),
            signerEmail: (signerEmail ?? campaign.signer_email ?? "").trim(),
          }),
        });
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          const message = data.error ?? "Failed to send for signature";
          setError(message);
          return message;
        }

        // Store the link so the agency can copy/share it manually if the
        // client's email didn't receive it.
        if (data.signUrl) {
          setSentSignLink({ campaignId: campaign.id, url: data.signUrl });
        }
        setCampaigns((prev) =>
          prev.map((c) =>
            c.id === campaign.id
              ? {
                  ...c,
                  docusign_status: data.status ?? "sent",
                  signer_name: data.signerName ?? c.signer_name,
                  signer_email: data.signerEmail ?? c.signer_email,
                }
              : c
          )
        );
        setPastCampaigns((prev) =>
          prev.map((c) =>
            c.id === campaign.id
              ? {
                  ...c,
                  docusign_status: data.status ?? "sent",
                  signer_name: data.signerName ?? c.signer_name,
                  signer_email: data.signerEmail ?? c.signer_email,
                }
              : c
          )
        );
        return null;
      } catch {
        const message = "Network error while sending for signature";
        setError(message);
        return message;
      } finally {
        setSendingSigId(null);
      }
    },
    []
  );

  // Refresh a proposal's signing status from the in-house sign_requests table
  // (manual pull — the client's signing page updates status live).
  const handleRefreshSignature = useCallback(async (campaign: StoredCampaign) => {
    try {
      const res = await fetch(`/api/seo/campaigns/${campaign.id}/sign-request`, {
        credentials: "include",
      });
      if (!res.ok) return;
      const data = await res.json();
      const requests = Array.isArray(data.requests) ? data.requests : [];
      const status = requests[0]?.status ?? "unsigned";
      setCampaigns((prev) =>
        prev.map((c) => (c.id === campaign.id ? { ...c, docusign_status: status } : c))
      );
      setPastCampaigns((prev) =>
        prev.map((c) => (c.id === campaign.id ? { ...c, docusign_status: status } : c))
      );
    } catch {
      // ignore
    }
  }, []);

  // Open the signing dialog pre-filled with the client's name/email.
  const openSignDialog = useCallback((campaign: StoredCampaign) => {
    setSignFormName(campaign.signer_name ?? "");
    setSignFormEmail(campaign.signer_email ?? "");
    setSignFormError(null);
    setSignDialogCampaign(campaign);
  }, []);

  // Submit the signing dialog: validate the email, send the link, and close
  // on success (the copyable link + "emailed to" feedback renders in the card).
  const submitSignDialog = useCallback(async () => {
    if (!signDialogCampaign) return;
    if (!signFormEmail || !signFormEmail.includes("@")) {
      setSignFormError("Enter a valid email address for the client.");
      return;
    }
    setSignFormError(null);
    const err = await handleSendForSignature(
      signDialogCampaign,
      signFormName,
      signFormEmail
    );
    if (err) {
      setSignFormError(err);
      return;
    }
    setSignDialogCampaign(null);
  }, [signDialogCampaign, signFormName, signFormEmail, handleSendForSignature]);

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

          <div>
            <label
              htmlFor="location"
              className="block text-sm font-medium mb-1.5"
            >
              Business Location (optional)
            </label>
            <input
              id="location"
              type="text"
              placeholder="e.g., Toronto, Ontario, Canada"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <p className="text-xs text-muted-foreground mt-1.5">
              Helps the auditor qualify competitors, keywords and rankings for
              the right market (local SEO).
            </p>
          </div>

          <div>
            <label
              htmlFor="competitors"
              className="block text-sm font-medium mb-1.5"
            >
              Competitors (optional)
            </label>
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <input
                  key={i}
                  type="text"
                  placeholder={`Competitor website ${i + 1} (optional) — e.g., https://rival.com`}
                  value={competitorUrls[i] ?? ""}
                  onChange={(e) => {
                    const next = [...competitorUrls];
                    next[i] = e.target.value;
                    setCompetitorUrls(next);
                  }}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
                />
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">
              Adding up to three competitors keeps the proposal from being too
              generic — we'll analyze them against your site. Leave blank to
              auto-discover.
            </p>
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
            {location.trim() && (
              <div>
                <span className="text-muted-foreground">Location:</span>{" "}
                <span className="font-medium">{location.trim()}</span>
              </div>
            )}
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

          {/* Competitor benchmark — always visible, no expansion needed */}
          {campaigns.length > 0 && (
            <CompetitorBenchmarkTable competitors={campaigns[0].competitors_json ?? []} />
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
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => setShowAuditLink((v) => !v)}
              >
                {showAuditLink ? "Hide Report Link" : "Share Audit Report"}
              </Button>
              <Button
                variant="outline"
                onClick={handlePresentToClient}
                disabled={presented}
              >
                {presented ? "Ready to Share ✓" : "Share with Client"}
              </Button>
            </div>
          </div>

          {showAuditLink && campaigns[0] && (
            <div className="mb-4 p-4 rounded-md bg-muted/50 border border-border space-y-3">
              <p className="text-sm font-medium">
                📊 Audit report link — share with anyone (no login needed):
              </p>
              <div className="space-y-2">
                <code className="block p-2 bg-muted rounded text-xs break-all font-mono text-muted-foreground">
                  {window.location.origin}/audit/{campaigns[0].id}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    navigator.clipboard
                      .writeText(`${window.location.origin}/audit/${campaigns[0].id}`)
                      .then(() => alert("Audit report link copied!"));
                  }}
                >
                  📋 Copy Report Link
                </Button>
                <a href="/dashboard/seo/audit-links">
                  <Button size="sm" variant="outline">
                    Manage all links
                  </Button>
                </a>
              </div>
            </div>
          )}

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
              const cj = campaign.campaign_json ?? ({} as CampaignJson);
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

                      {/* DocuSign signature status / send */}
                      {(campaign.docusign_status === "completed" ||
                        campaign.docusign_status === "sent" ||
                        campaign.docusign_status === "delivered" ||
                        campaign.docusign_status === "declined" ||
                        campaign.docusign_status === "voided") && (
                        <div className="mb-3 flex items-center justify-between text-xs">
                          <span
                            className={
                              campaign.docusign_status === "completed"
                                ? "text-green-600 font-medium"
                                : campaign.docusign_status === "declined" || campaign.docusign_status === "voided"
                                ? "text-red-600 font-medium"
                                : "text-muted-foreground"
                            }
                          >
                            {campaign.docusign_status === "completed"
                              ? `✓ Signed${campaign.signer_name ? ` by ${campaign.signer_name}` : ""}`
                              : campaign.docusign_status === "declined"
                              ? "Signature declined"
                              : campaign.docusign_status === "voided"
                              ? "Signature voided"
                              : "Signing link sent — awaiting signature"}
                          </span>
                          {campaign.docusign_status !== "completed" && (
                            <button
                              onClick={() => handleRefreshSignature(campaign)}
                              className="text-primary hover:underline"
                            >
                              Refresh status
                            </button>
                          )}
                        </div>
                      )}

                      {/* Copiable signing link after sending */}
                      {sentSignLink && sentSignLink.campaignId === campaign.id && (
                        <div className="mb-3 flex items-center gap-2 text-xs">
                          <span className="text-muted-foreground">Signing link:</span>
                          <button
                            onClick={() => {
                              navigator.clipboard
                                ?.writeText(sentSignLink.url)
                                .catch(() => {});
                            }}
                            className="text-primary hover:underline truncate max-w-[260px]"
                            title="Click to copy"
                          >
                            {sentSignLink.url}
                          </button>
                        </div>
                      )}

                      {/* Actions */}
                      <div className="grid grid-cols-2 gap-2 mt-auto pt-4 border-t">
                        <Button
                          variant="default"
                          size="sm"
                          className="col-span-2"
                          disabled={startingCampaignId !== null}
                          onClick={() => setStartDialogCampaign(campaign.id)}
                          title="Seed a dated campaign plan on the Content Calendar from this tier's content calendar — no AI cost, then refine with the team."
                        >
                          {startingCampaignId === campaign.id ? (
                            <>
                              <Loader2 className="size-3.5 animate-spin mr-1" />
                              Starting…
                            </>
                          ) : (
                            <>
                              <Rocket className="size-3.5 mr-1" />
                              Start Campaign
                            </>
                          )}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={sendingSigId !== null || campaign.docusign_status === "completed"}
                          onClick={() =>
                            campaign.docusign_status === "completed"
                              ? undefined
                              : campaign.docusign_status === "sent"
                              ? handleRefreshSignature(campaign)
                              : openSignDialog(campaign)
                          }
                          title={
                            campaign.docusign_status === "completed"
                              ? "This proposal is already signed."
                              : "Send this proposal to the client for e-signature — the campaign auto-starts once signed."
                          }
                        >
                          {sendingSigId === campaign.id ? (
                            <>
                              <Loader2 className="size-3.5 animate-spin mr-1" />
                              Sending…
                            </>
                          ) : campaign.docusign_status === "completed" ? (
                            "✓ Signed"
                          ) : campaign.docusign_status === "sent" ? (
                            "Check Signature"
                          ) : (
                            "Send for Signature"
                          )}
                        </Button>
                        {campaign.docusign_status === "completed" && campaign.signed_document_url ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => window.open(campaign.signed_document_url!, "_blank")}
                            title="Open the signed contract PDF stored in this workspace."
                          >
                            View Signed Contract
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setExpandedCampaign(campaign.id)}
                          >
                            View Details
                          </Button>
                        )}
                      </div>
                    </>
                  )}

                  {/* Expanded detailed view */}
                  {isExpanded && (
                    <div className="mt-4 border-t pt-4 space-y-6">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex gap-2 flex-wrap">
                          <Button
                            variant="default"
                            size="sm"
                            disabled={startingCampaignId !== null}
                            onClick={() => setStartDialogCampaign(campaign.id)}
                          >
                            {startingCampaignId === campaign.id ? (
                              <>
                                <Loader2 className="size-3.5 animate-spin mr-1" />
                                Starting…
                              </>
                            ) : (
                              <>
                                <Rocket className="size-3.5 mr-1" />
                                Start Campaign
                              </>
                            )}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={sendingSigId !== null || campaign.docusign_status === "completed"}
                            onClick={() =>
                              campaign.docusign_status === "completed"
                                ? undefined
                                : campaign.docusign_status === "sent"
                                ? handleRefreshSignature(campaign)
                                : openSignDialog(campaign)
                            }
                          >
                            {sendingSigId === campaign.id ? (
                              <>
                                <Loader2 className="size-3.5 animate-spin mr-1" />
                                Sending…
                              </>
                            ) : campaign.docusign_status === "completed" ? (
                              "✓ Signed"
                            ) : campaign.docusign_status === "sent" ? (
                              "Check Signature"
                            ) : (
                              "Send for Signature"
                            )}
                          </Button>
                          {campaign.docusign_status === "completed" && campaign.signed_document_url && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => window.open(campaign.signed_document_url!, "_blank")}
                              title="Open the signed contract PDF stored in this workspace."
                            >
                              View Signed Contract
                            </Button>
                          )}
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => setExpandedCampaign(null)}>
                          Collapse
                        </Button>
                      </div>
                      {campaign.audit_json && (
                        <div className="space-y-4 rounded-lg border border-border p-4">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <h3 className="text-md font-semibold">
                              Site Audit & Competitor Benchmark
                            </h3>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleRerunAudit(campaign.id)}
                              disabled={rerunningAuditId !== null}
                              title="Re-score this campaign's competitor benchmarks from a fresh crawl (no LLM cost, no client-site re-crawl)."
                            >
                              {rerunningAuditId === campaign.id ? (
                                <Loader2 className="size-3.5 animate-spin mr-1" />
                              ) : (
                                <RefreshCw className="size-3.5 mr-1" />
                              )}
                              Re-run audit
                            </Button>
                          </div>
                          {auditNotice && (
                            <p className="text-xs text-muted-foreground">{auditNotice}</p>
                          )}
                          <AuditDetails
                            audit={campaign.audit_json}
                            competitors={campaign.competitors_json ?? []}
                          />
                        </div>
                      )}
                      <CampaignDetails
                        campaign={campaign}
                        rankings={rankings[campaign.id]}
                      />
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

      {/* Send-for-signature dialog — collects the client's email (it's never
          on file by default), then emails them a private signing link. */}
      <Dialog
        open={!!signDialogCampaign}
        onOpenChange={(open) => !open && setSignDialogCampaign(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Send proposal for e-signature</DialogTitle>
            <DialogDescription>
              Emails <span className="font-medium">{signFormEmail || "the client"}</span> a
              private signing link. They review the proposal and terms, sign
              online, and the signed agreement is stored in the workspace — the
              campaign auto-starts once signed.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label htmlFor="signName" className="block text-sm font-medium mb-1.5">
                Client name
              </label>
              <input
                id="signName"
                type="text"
                value={signFormName}
                onChange={(e) => setSignFormName(e.target.value)}
                placeholder="e.g., Jane Smith"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div>
              <label htmlFor="signEmail" className="block text-sm font-medium mb-1.5">
                Client email
              </label>
              <input
                id="signEmail"
                type="email"
                value={signFormEmail}
                onChange={(e) => setSignFormEmail(e.target.value)}
                placeholder="client@example.com"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <p className="text-xs text-muted-foreground mt-1.5">
                The signing link is emailed here and also shown on the proposal
                card so you can copy/share it manually.
              </p>
            </div>
            {signFormError && (
              <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm">
                {signFormError}
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="ghost"
              disabled={sendingSigId === signDialogCampaign?.id}
              onClick={() => setSignDialogCampaign(null)}
            >
              Cancel
            </Button>
            <Button
              variant="default"
              disabled={sendingSigId === signDialogCampaign?.id}
              onClick={submitSignDialog}
            >
              {sendingSigId === signDialogCampaign?.id ? (
                <Loader2 className="size-4 animate-spin mr-1" />
              ) : null}
              Send signing link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Start-campaign setup dialog — asks if a website is part of the build */}
      <Dialog
        open={!!startDialogCampaign}
        onOpenChange={(open) => !open && !startBusy && setStartDialogCampaign(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Start this campaign</DialogTitle>
            <DialogDescription>
              Seeds the tier&apos;s content calendar as proposed items on your
              Content Calendar — no AI cost, then refine with the team.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm font-semibold">First — does the client need or have a website?</p>
            <div className="grid gap-2">
              <button
                type="button"
                onClick={() => setStartIncludeWebsite(true)}
                className={`flex items-start gap-3 rounded-md border p-3 text-left transition-colors ${startIncludeWebsite ? "border-primary bg-primary/5" : "hover:bg-muted/40"}`}
              >
                <Globe className={`size-5 mt-0.5 shrink-0 ${startIncludeWebsite ? "text-primary" : "text-muted-foreground"}`} />
                <span>
                  <span className="flex items-center gap-1.5 font-medium text-sm">
                    They need a website built
                  </span>
                  <span className="text-xs text-muted-foreground block mt-0.5">
                    The web build is added to the campaign — Ray structures the
                    pages, design and launch milestones, and the site is built
                    in the Web Builder as part of the flow.
                  </span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => setStartIncludeWebsite(false)}
                className={`flex items-start gap-3 rounded-md border p-3 text-left transition-colors ${!startIncludeWebsite ? "border-primary bg-primary/5" : "hover:bg-muted/40"}`}
              >
                <FileSearch className={`size-5 mt-0.5 shrink-0 ${!startIncludeWebsite ? "text-primary" : "text-muted-foreground"}`} />
                <span>
                  <span className="flex items-center gap-1.5 font-medium text-sm">
                    They already have a website
                  </span>
                  <span className="text-xs text-muted-foreground block mt-0.5">
                    The SEO audit is done (or run one) and the campaign is
                    recommended from its findings — no site build in the plan.
                  </span>
                </span>
              </button>
            </div>

            {startIncludeWebsite && (
              <div className="rounded-md border bg-muted/30 p-3 text-xs space-y-3">
                <p className="font-semibold text-sm">Suggested website plan</p>
                <div>
                  <p className="text-muted-foreground font-medium mb-1 flex items-center gap-1.5">
                    <FileText className="size-3.5 text-primary" /> Pages
                  </p>
                  <ul className="space-y-0.5 text-muted-foreground">
                    {WEBSITE_PLAN.pages.map((p) => <li key={p}>• {p}</li>)}
                  </ul>
                </div>
                <div>
                  <p className="text-muted-foreground font-medium mb-1 flex items-center gap-1.5">
                    <Wrench className="size-3.5 text-primary" /> Functions
                  </p>
                  <ul className="space-y-0.5 text-muted-foreground">
                    {WEBSITE_PLAN.functions.map((f) => <li key={f}>• {f}</li>)}
                  </ul>
                </div>
                <div>
                  <p className="text-muted-foreground font-medium mb-1 flex items-center gap-1.5">
                    <Puzzle className="size-3.5 text-primary" /> Add-ons / plugins
                  </p>
                  <ul className="space-y-0.5 text-muted-foreground">
                    {WEBSITE_PLAN.plugins.map((pl) => <li key={pl}>• {pl}</li>)}
                  </ul>
                </div>
                <p className="text-muted-foreground pt-1">
                  Ray and the team use this as the blueprint — every piece gets
                  built in the Web Builder and tracked on the campaign calendar.
                </p>
              </div>
            )}
            <label className="flex items-start gap-3 rounded-md border p-3 cursor-pointer hover:bg-muted/40 transition-colors">
              <Checkbox
                checked={startCreateWorkspace}
                onCheckedChange={(v) => setStartCreateWorkspace(v === true)}
                className="mt-0.5"
              />
              <span>
                <span className="flex items-center gap-1.5 font-medium text-sm">
                  <FolderPlus className="size-4 text-primary" /> Create a dedicated workspace
                </span>
                <span className="text-xs text-muted-foreground block mt-0.5">
                  Keeps this campaign&apos;s plan, posts and chats isolated from
                  your general work (falls back to this workspace at quota).
                </span>
              </span>
            </label>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="ghost"
              disabled={startBusy}
              onClick={() => setStartDialogCampaign(null)}
            >
              Cancel
            </Button>
            <Button
              variant="default"
              disabled={startBusy}
              onClick={() => startDialogCampaign && startCampaign(startDialogCampaign)}
            >
              {startBusy ? (
                <Loader2 className="size-4 animate-spin mr-1" />
              ) : (
                <Rocket className="size-4 mr-1" />
              )}
              Start Campaign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============================================================================
// Competitor Benchmark Table — a compact scoreboard for the Site Audit
// Summary, so the benchmark is visible right after generation without
// expanding anything. Renders an honest empty state when the audit had no
// competitors (or they haven't been crawled yet).
// ============================================================================

function CompetitorBenchmarkTable({ competitors }: { competitors: CompetitorData[] }) {
  const lastScored = competitors.reduce<string | null>((latest, c) => {
    return c.scoredAt && (!latest || c.scoredAt > latest) ? c.scoredAt : latest;
  }, null);

  return (
    <div className="mt-4 border-t pt-4">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
        <h3 className="text-sm font-semibold">Competitor Benchmark</h3>
        {lastScored && (
          <span className="text-[11px] text-muted-foreground">
            Last benchmarked {new Date(lastScored).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </span>
        )}
      </div>
      {competitors.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No competitors were benchmarked for this audit. Add up to three
          competitors when you run an audit to see how this site stacks up
          against them (SEO / AEO / GEO scores).
        </p>
      ) : (
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
                        {c.crawled === false ? (
                          <span className="text-muted-foreground">—</span>
                        ) : v == null ? (
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
      )}
      {competitors.length > 0 && (
        <p className="text-[11px] text-muted-foreground mt-2 italic">
          Competitor scores come from the same SEO / AEO / GEO engines used for
          this audit, refreshed automatically every month (or with “Re-run audit”
          in the expanded view).
        </p>
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
            {competitors.map((comp, i) => {
              const compScores = [
                { label: "SEO", v: comp.seoScore },
                { label: "AEO", v: comp.aeoScore },
                { label: "GEO", v: comp.geoScore },
              ];
              return (
              <div key={i} className="p-4 rounded-lg border">
                <h4 className="font-medium text-sm mb-2 text-primary">{comp.competitorUrl?.replace(/^https?:\/\//, "")}</h4>
                {comp.crawled !== false && compScores.some((s) => s.v != null) && (
                  <div className="mb-2 flex flex-wrap items-center gap-3 text-xs">
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
                {comp.crawled === false && (
                  <div className="mb-2 text-xs text-muted-foreground italic">Not crawlable — benchmark unavailable.</div>
                )}
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
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Campaign Details Component (expanded view)
// ============================================================================

function CampaignDetails({
  campaign,
  rankings,
}: {
  campaign: StoredCampaign;
  rankings?: Record<string, KeywordRank>;
}) {
  const cj = campaign.campaign_json ?? ({} as CampaignJson);

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

      {/* Website plan — when the campaign includes a website build */}
      {cj.websitePlan && (
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
          <h3 className="text-sm font-semibold mb-1 flex items-center gap-1.5">
            <Globe className="size-4 text-primary" /> Website Build Plan
          </h3>
          <p className="text-xs text-muted-foreground mb-3">
            Included in this campaign — Ray and the team build these in the Web
            Builder and track them on the campaign calendar.
          </p>
          <div className="grid gap-4 md:grid-cols-3 text-xs">
            <div>
              <p className="font-semibold text-primary mb-1 flex items-center gap-1">
                <FileText className="size-3.5" /> Pages
              </p>
              <ul className="space-y-0.5 text-muted-foreground">
                {cj.websitePlan.pages?.map((p) => <li key={p}>• {p}</li>)}
              </ul>
            </div>
            <div>
              <p className="font-semibold text-primary mb-1 flex items-center gap-1">
                <Wrench className="size-3.5" /> Functions
              </p>
              <ul className="space-y-0.5 text-muted-foreground">
                {cj.websitePlan.functions?.map((f) => <li key={f}>• {f}</li>)}
              </ul>
            </div>
            <div>
              <p className="font-semibold text-primary mb-1 flex items-center gap-1">
                <Puzzle className="size-3.5" /> Add-ons / plugins
              </p>
              <ul className="space-y-0.5 text-muted-foreground">
                {cj.websitePlan.plugins?.map((pl) => <li key={pl}>• {pl}</li>)}
              </ul>
            </div>
          </div>
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
                  <th className="py-2 pr-4 font-medium">Current Rank</th>
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
                    <td className="py-2">
                      {(() => {
                        const measured = rankings?.[kw.keyword];
                        if (measured) {
                          return (
                            <span
                              className="font-medium text-green-600 dark:text-green-400"
                              title={`Measured via Search Console (${measured.impressions} impressions, ${measured.clicks} clicks)`}
                            >
                              #{measured.position}
                            </span>
                          );
                        }
                        if (kw.currentRanking != null) {
                          return (
                            <span className="font-medium">#{kw.currentRanking}</span>
                          );
                        }
                        return (
                          <span
                            className="text-muted-foreground"
                            title="Not measured yet — Search Console keyword data for this campaign appears after the next traffic sync."
                          >
                            —
                          </span>
                        );
                      })()}
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