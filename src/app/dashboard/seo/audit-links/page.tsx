"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Loader2, Link2, Copy, RefreshCw, Ban, CheckCircle2 } from "lucide-react";

interface Campaign {
  id: string;
  url: string;
  tier_name: string | null;
  tier_price: number | null;
  status: string | null;
  audit_json?: { scannedAt?: string } | null;
  share_enabled?: boolean;
  share_token?: string | null;
  created_at?: string | null;
}

interface AuditGroup {
  key: string;
  url: string;
  scannedAt: string | null;
  tiers: Campaign[];
}

function groupAudits(campaigns: Campaign[]): AuditGroup[] {
  const groups = new Map<string, AuditGroup>();
  for (const c of campaigns) {
    const scannedAt = c.audit_json?.scannedAt ?? null;
    const dateKey = scannedAt?.slice(0, 10) ?? c.created_at?.slice(0, 10) ?? "unknown";
    const key = `${c.url}::${dateKey}`;
    if (!groups.has(key)) {
      groups.set(key, { key, url: c.url, scannedAt, tiers: [] });
    }
    groups.get(key)!.tiers.push(c);
  }
  return [...groups.values()].sort((a, b) =>
    (b.scannedAt ?? "").localeCompare(a.scannedAt ?? "")
  );
}

export default function AuditLinksPage() {
  const [groups, setGroups] = useState<AuditGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/seo/campaigns", { credentials: "include" });
      if (!res.ok) {
        setError("Could not load audits.");
        return;
      }
      const data = await res.json();
      setGroups(groupAudits(data.campaigns ?? []));
    } catch {
      setError("Could not load audits.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const linkFor = (c: Campaign) =>
    `${window.location.origin}/audit/${c.share_token ?? c.id}`;

  const updateShare = async (
    c: Campaign,
    body: { enabled?: boolean; regenerate?: boolean }
  ) => {
    setBusyId(c.id);
    try {
      const res = await fetch(`/api/seo/campaigns/${c.id}/share`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Update failed.");
      }
      await fetchAll();
    } catch {
      setError("Network error while updating the share link.");
    } finally {
      setBusyId(null);
    }
  };

  const copyLink = async (c: Campaign) => {
    try {
      await navigator.clipboard.writeText(linkFor(c));
      setCopiedId(c.id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      // clipboard may be unavailable — show the link instead
    }
  };

  const totalLinks = groups.reduce((s, g) => s + g.tiers.length, 0);
  const revoked = groups.reduce(
    (s, g) => s + g.tiers.filter((t) => t.share_enabled === false).length,
    0
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Link2 className="size-7 text-primary" />
            Audit Share Links
          </h1>
          <p className="text-muted-foreground mt-1">
            Public audit reports per site audit — copy, revoke, or regenerate each
            link. {totalLinks} link(s), {revoked} revoked.
          </p>
        </div>
        <Button variant="outline" onClick={fetchAll} disabled={loading}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : "Refresh"}
        </Button>
      </div>

      {error && (
        <div className="bg-destructive/10 text-destructive text-sm rounded-md px-4 py-3">
          {error}
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-24 text-muted-foreground">
          <Loader2 className="size-8 animate-spin mr-3" />
          Loading audits…
        </div>
      )}

      {!loading && groups.length === 0 && (
        <Card>
          <CardContent className="py-16 text-center">
            <p className="font-semibold">No audits yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Run an SEO audit to generate shareable reports.
            </p>
          </CardContent>
        </Card>
      )}

      {groups.map((group) => (
        <Card key={group.key}>
          <CardHeader>
            <CardTitle className="text-base">
              {group.url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
            </CardTitle>
            <CardDescription>
              {group.scannedAt
                ? `Audited ${new Date(group.scannedAt).toLocaleDateString("en-US", {
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })}`
                : "Audit"}
              {" · "}
              {group.tiers.length} tier{group.tiers.length === 1 ? "" : "s"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {group.tiers.map((c) => {
              const enabled = c.share_enabled !== false;
              const link = linkFor(c);
              return (
                <div
                  key={c.id}
                  className="flex flex-col md:flex-row md:items-center gap-3 p-3 rounded-lg border"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">{c.tier_name ?? "Tier"}</span>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${
                          enabled
                            ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300"
                            : "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
                        }`}
                      >
                        {enabled ? "Live" : "Revoked"}
                      </span>
                      <span className="text-xs text-muted-foreground capitalize">
                        {c.status ?? ""}
                      </span>
                    </div>
                    <code className="block text-xs text-muted-foreground break-all mt-1">
                      {link}
                    </code>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!enabled}
                      onClick={() => copyLink(c)}
                    >
                      {copiedId === c.id ? (
                        <CheckCircle2 className="size-4 text-green-600" />
                      ) : (
                        <Copy className="size-4" />
                      )}
                      {copiedId === c.id ? "Copied" : "Copy"}
                    </Button>
                    <Button
                      size="sm"
                      variant={enabled ? "ghost" : "outline"}
                      disabled={busyId === c.id}
                      onClick={() => updateShare(c, { enabled: !enabled })}
                    >
                      <Ban className="size-4" />
                      {enabled ? "Revoke" : "Re-enable"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyId === c.id}
                      onClick={() => updateShare(c, { regenerate: true })}
                    >
                      <RefreshCw className="size-4" />
                      Regenerate
                    </Button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
