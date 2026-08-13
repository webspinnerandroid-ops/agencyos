"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Loader2, RefreshCw, ShieldAlert, CheckCircle2, XCircle } from "lucide-react";

interface ProviderRow {
  id: string;
  name: string;
  type: string;
  base_url?: string | null;
  connected: boolean;
  env_key?: string;
  tenant_key_count: number;
  balance_usd: number | null;
  currency: string;
  balance_note?: string;
  low_threshold_usd: number;
  checked_at: string | null;
  low: boolean;
}

interface ModelRow {
  id: string;
  model_identifier: string;
  supported_tasks: string[];
  is_deprecated: boolean;
  last_verified_at: string | null;
  provider: { id: string; name: string } | null;
}

export default function AdminApisPage() {
  const [tab, setTab] = useState<"apis" | "models">("apis");
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [models, setModels] = useState<ModelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/apis", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setProviders(data.providers ?? []);
      } else {
        const d = await res.json().catch(() => ({}));
        setMessage(d.error ?? "Failed to load APIs");
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  const loadModels = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/models", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setModels(data.models ?? []);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (tab === "models") loadModels();
  }, [tab, loadModels]);

  const refreshBalances = async () => {
    setRefreshing(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/apis", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? "Refresh failed");
        return;
      }
      setMessage(
        data.results?.length
          ? `Checked ${data.results.length} configured provider(s): ${data.results
              .map((r: any) =>
                r.balance != null
                  ? `${r.provider}=$${r.balance} ${r.currency ?? ""}`
                  : r.note
                  ? `${r.provider} — ${r.note}`
                  : `${r.provider}=n/a`
              )
              .join(" · ")}`
          : "No providers are configured yet — add API keys (platform env or Settings → AI) first."
      );
      load();
    } finally {
      setRefreshing(false);
    }
  };

  const setThreshold = async (providerId: string, value: number) => {
    await fetch("/api/admin/apis", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ thresholds: { [providerId]: value } }),
    });
    load();
  };

  const verifyFalModels = async () => {
    setVerifying(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/models", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verify: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? "Verification failed");
        return;
      }
      const gone = (data.checked ?? []).filter((c: any) => !c.exists);
      setMessage(
        `Verified ${data.checked?.length ?? 0} fal.ai models. ${gone.length ? `${gone.length} no longer available (flagged deprecated).` : "All available."}`
      );
      loadModels();
    } finally {
      setVerifying(false);
    }
  };

  const toggleDeprecated = async (m: ModelRow) => {
    await fetch("/api/admin/models", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deprecate: { id: m.id, is_deprecated: !m.is_deprecated } }),
    });
    loadModels();
  };

  const lowCount = providers.filter((p) => p.low).length;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">APIs &amp; Model Registry</h1>
          <p className="text-muted-foreground mt-1">
            The AI providers you are responsible for — connection state, balances,
            and model availability.
          </p>
        </div>
        {lowCount > 0 && (
          <span className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-full bg-red-100 text-red-700 dark:bg-red-950">
            <ShieldAlert className="size-4" /> {lowCount} provider{lowCount === 1 ? "" : "s"} below balance threshold
          </span>
        )}
      </div>

      {message && (
        <div className="p-3 rounded-md bg-blue-50 text-blue-700 border border-blue-200 text-sm">{message}</div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b pb-2">
        <button onClick={() => setTab("apis")}
          className={`text-sm font-medium px-3 py-1.5 rounded-t-md ${tab === "apis" ? "bg-muted" : "text-muted-foreground"}`}>
          APIs &amp; Balances
        </button>
        <button onClick={() => setTab("models")}
          className={`text-sm font-medium px-3 py-1.5 rounded-t-md ${tab === "models" ? "bg-muted" : "text-muted-foreground"}`}>
          Model Registry ({models.filter((m) => m.is_deprecated).length} deprecated)
        </button>
      </div>

      {tab === "apis" && (
        <>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={refreshBalances} disabled={refreshing}>
              {refreshing ? <Loader2 className="size-4 animate-spin mr-1" /> : <RefreshCw className="size-4 mr-1" />}
              Check balances
            </Button>
            <span className="text-xs text-muted-foreground">
              Only providers with an API configured are listed and queried. Providers without a balance
              endpoint say so next to their name — no invented numbers.
            </span>
          </div>

          {loading ? (
            <div className="flex justify-center py-12"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
          ) : (
            <div className="space-y-3">
              {providers.map((p) => (
                <Card key={p.id} className="p-4">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{p.name}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground uppercase">{p.type}</span>
                        {p.connected ? (
                          <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-950"><CheckCircle2 className="size-3" /> Connected</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 dark:bg-gray-800"><XCircle className="size-3" /> Not connected</span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{p.base_url}</p>
                      <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                        <span>{p.env_key ? `Platform key: ${p.env_key}` : "No platform key"}</span>
                        <span>{p.tenant_key_count > 0 ? `${p.tenant_key_count} tenant key${p.tenant_key_count === 1 ? "" : "s"}` : "No tenant keys"}</span>
                        {p.checked_at && <span>Checked {new Date(p.checked_at).toLocaleString()}</span>}
                      </div>
                      {p.balance_note && p.balance_usd == null && (
                        <p className="text-xs mt-1.5 text-amber-600 dark:text-amber-400">
                          {p.balance_note}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-3 shrink-0 flex-wrap">
                      {p.balance_usd != null ? (
                        <span className={`text-lg font-bold tabular-nums ${p.low ? "text-red-600" : "text-green-600"}`}>
                          ${Number(p.balance_usd).toFixed(2)} <span className="text-xs font-normal text-muted-foreground">{p.currency}</span>
                        </span>
                      ) : (
                        <span className="text-sm text-muted-foreground">No balance available</span>
                      )}
                      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        Low alert &lt;
                        <Input
                          type="number"
                          defaultValue={p.low_threshold_usd}
                          onBlur={(e) => setThreshold(p.id, Number(e.target.value) || 0)}
                          className="w-20 h-7 text-xs"
                        />
                      </label>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {tab === "models" && (
        <>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={verifyFalModels} disabled={verifying}>
              {verifying ? <Loader2 className="size-4 animate-spin mr-1" /> : <RefreshCw className="size-4 mr-1" />}
              Verify fal.ai availability
            </Button>
            <span className="text-xs text-muted-foreground">
              Fetches each fal.ai model page — retired models are flagged and hidden from selectors.
            </span>
          </div>

          <Card className="p-4">
            <div className="space-y-2">
              {models.map((m) => (
                <div key={m.id} className="flex items-center justify-between gap-3 p-2 rounded-lg border hover:bg-muted/30">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{m.model_identifier}</p>
                    <p className="text-xs text-muted-foreground">
                      {m.provider?.name ?? "?"} · {(m.supported_tasks ?? []).join(", ")}
                      {m.last_verified_at && ` · verified ${new Date(m.last_verified_at).toLocaleDateString()}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {m.is_deprecated ? (
                      <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-950"><ShieldAlert className="size-3" /> Deprecated</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-950"><CheckCircle2 className="size-3" /> Active</span>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => toggleDeprecated(m)}>
                      {m.is_deprecated ? "Restore" : "Deprecate"}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
