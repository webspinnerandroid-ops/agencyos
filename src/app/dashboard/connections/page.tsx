"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Loader2, Link2, Unplug, RefreshCw, CheckCircle2, AlertTriangle, BarChart3, Search } from "lucide-react";
import type { GA4PropertyOption } from "@/lib/connections";
import {
  getConnections,
  initiateConnection,
  getResources,
  selectResource,
  disconnectConnection,
} from "./actions";

type Provider = "google_analytics" | "search_console";

interface ConnectionRow {
  id: string;
  provider: Provider;
  account_email: string | null;
  account_name: string | null;
  scopes: string | null;
  selected_resource: string | null;
  resource_label: string | null;
  connected: boolean;
  last_synced_at: string | null;
}

interface ResourceOption {
  value: string;
  label: string;
}

const PROVIDERS: { provider: Provider; title: string; blurb: string; icon: typeof BarChart3 }[] = [
  {
    provider: "google_analytics",
    title: "Google Analytics 4",
    blurb: "Connect a GA4 property to pull real traffic, engagement and conversion metrics into this workspace's analytics.",
    icon: BarChart3,
  },
  {
    provider: "search_console",
    title: "Search Console",
    blurb: "Connect a verified site to track impressions, clicks, average position and queries straight from Google.",
    icon: Search,
  },
];

export default function ConnectionsPage() {
  const [rows, setRows] = useState<ConnectionRow[] | null>(null);
  const [googleConfigured, setGoogleConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Provider | null>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Resource picker state per provider
  const [options, setOptions] = useState<Record<Provider, ResourceOption[]>>({
    google_analytics: [],
    search_console: [],
  });
  const [showPicker, setShowPicker] = useState<Record<Provider, boolean>>({
    google_analytics: false,
    search_console: false,
  });
  const [picked, setPicked] = useState<Record<Provider, string>>({
    google_analytics: "",
    search_console: "",
  });
  const [pickerBusy, setPickerBusy] = useState<Provider | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await getConnections();
    if (!res.success) {
      setFeedback({ type: "error", message: res.error ?? "Failed to load connections" });
    } else {
      setRows(res.data ?? []);
      setGoogleConfigured(res.googleConfigured);
      // Pre-fill picks from stored selections
      for (const c of res.data ?? []) {
        if (c.selected_resource) {
          setPicked((p) => ({ ...p, [c.provider]: c.selected_resource! }));
        }
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    // Surface the OAuth round-trip result from the callback redirect.
    const params = new URLSearchParams(window.location.search);
    const success = params.get("success");
    const error = params.get("error");
    if (success) {
      setFeedback({
        type: "success",
        message: success.includes("google_analytics")
          ? "Google Analytics connected. Pick which property to track."
          : "Search Console connected. Pick which site to track.",
      });
    } else if (error) {
      setFeedback({
        type: "error",
        message:
          error === "oauth_denied"
            ? "Connection cancelled in the Google consent screen."
            : error === "invalid_state"
              ? "This connection link expired — please try connecting again."
              : "Something went wrong connecting to Google. Please try again.",
      });
    }
    // Clean the query params so a refresh doesn't re-show the banner.
    if (success || error) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [load]);

  const connect = async (provider: Provider) => {
    setBusy(provider);
    setFeedback(null);
    const res = await initiateConnection(provider);
    setBusy(null);
    if (!res.success || !res.data) {
      setFeedback({ type: "error", message: res.error ?? "Failed to start connection" });
      return;
    }
    window.location.href = res.data.redirectUrl;
  };

  const loadPicker = async (provider: Provider) => {
    setPickerBusy(provider);
    setFeedback(null);
    const res = await getResources(provider);
    setPickerBusy(null);
    if (!res.success || !res.data) {
      setFeedback({ type: "error", message: res.error ?? "Failed to load resources" });
      return;
    }
    const opts =
      res.data.kind === "ga4"
        ? (res.data.options as GA4PropertyOption[]).map((p) => ({
            value: p.propertyId,
            label: `${p.displayName} (${p.accountName})`,
          }))
        : (res.data.options as { siteUrl: string; permissionLevel: string }[]).map((s) => ({
            value: s.siteUrl,
            label: s.siteUrl,
          }));
    setOptions((o) => ({ ...o, [provider]: opts }));
    setShowPicker((s) => ({ ...s, [provider]: true }));
    if (opts.length === 0) {
      setFeedback({
        type: "error",
        message:
          provider === "google_analytics"
            ? "No GA4 properties found on this Google account. Create one in the Google Analytics admin first."
            : "No Search Console sites found. Verify a site in Search Console first.",
      });
    }
  };

  const savePick = async (provider: Provider) => {
    const value = picked[provider];
    if (!value) {
      setFeedback({ type: "error", message: "Select a property or site first." });
      return;
    }
    const label = options[provider].find((o) => o.value === value)?.label ?? value;
    setBusy(provider);
    const res = await selectResource(provider, value, label);
    setBusy(null);
    if (!res.success) {
      setFeedback({ type: "error", message: res.error ?? "Failed to save selection" });
      return;
    }
    setFeedback({ type: "success", message: "Tracking selection saved." });
    setShowPicker((s) => ({ ...s, [provider]: false }));
    await load();
  };

  const disconnect = async (provider: Provider) => {
    if (!confirm("Disconnect this account? Analytics will stop updating until you reconnect.")) return;
    setBusy(provider);
    const res = await disconnectConnection(provider);
    setBusy(null);
    if (!res.success) {
      setFeedback({ type: "error", message: res.error ?? "Failed to disconnect" });
      return;
    }
    setFeedback({ type: "success", message: "Disconnected." });
    await load();
  };

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Link2 className="size-7 text-primary" /> Connections
        </h1>
        <p className="text-muted-foreground mt-1">
          Connect the data sources this workspace reports on. Each connection uses your Google
          account — tokens are encrypted at rest and never shared between tenants.
        </p>
      </div>

      {feedback && (
        <div className={`p-3 rounded-md text-sm border ${feedback.type === "success" ? "bg-green-50 text-green-700 border-green-200" : "bg-red-50 text-red-700 border-red-200"}`} role="alert">
          {feedback.message}
          <button className="ml-3 underline text-xs" onClick={() => setFeedback(null)}>Dismiss</button>
        </div>
      )}

      {!googleConfigured && (
        <div className="p-4 rounded-md border border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-100 text-sm flex items-start gap-2">
          <AlertTriangle className="size-4 mt-0.5 shrink-0" />
          <div>
            <strong>Google OAuth is not configured on this deployment.</strong>{" "}
            The server needs <code className="px-1 rounded bg-amber-100 dark:bg-amber-900">GOOGLE_CLIENT_ID</code> and{" "}
            <code className="px-1 rounded bg-amber-100 dark:bg-amber-900">GOOGLE_CLIENT_SECRET</code> set, with the callback URL
            <code className="px-1 rounded bg-amber-100 dark:bg-amber-900">/api/auth/callback/google</code> added as an authorized redirect URI in Google Cloud.
          </div>
        </div>
      )}

      {loading && !rows ? (
        <div className="flex items-center justify-center py-24 text-muted-foreground">
          <Loader2 className="size-8 animate-spin mr-3" /> Loading connections…
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {PROVIDERS.map(({ provider, title, blurb, icon: Icon }) => {
            const conn = (rows ?? []).find((r) => r.provider === provider);
            return (
              <Card key={provider} className="p-5 flex flex-col gap-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="size-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                      <Icon className="size-5" />
                    </div>
                    <div>
                      <h2 className="font-semibold text-lg leading-tight">{title}</h2>
                      <p className="text-xs text-muted-foreground">{blurb}</p>
                    </div>
                  </div>
                  {conn?.connected ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600 shrink-0">
                      <CheckCircle2 className="size-4" /> Connected
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground shrink-0">
                      <span className="size-2 rounded-full bg-muted-foreground/50" /> Not connected
                    </span>
                  )}
                </div>

                {conn?.connected ? (
                  <>
                    <div className="text-sm space-y-1 bg-muted/30 rounded-md p-3">
                      <div className="font-medium">{conn.account_name ?? "Google account"}</div>
                      {conn.account_email && (
                        <div className="text-xs text-muted-foreground">{conn.account_email}</div>
                      )}
                      {conn.resource_label ? (
                        <div className="text-xs text-primary mt-1">
                          Tracking: {conn.resource_label}
                        </div>
                      ) : (
                        <div className="text-xs text-amber-600 mt-1">
                          No property selected yet — choose what to track below.
                        </div>
                      )}
                    </div>

                    {showPicker[provider] ? (
                      <div className="space-y-2">
                        <select
                          value={picked[provider]}
                          onChange={(e) => setPicked((p) => ({ ...p, [provider]: e.target.value }))}
                          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                        >
                          <option value="">
                            {provider === "google_analytics" ? "Select a GA4 property…" : "Select a site…"}
                          </option>
                          {options[provider].map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                        <div className="flex items-center gap-2">
                          <Button size="sm" onClick={() => savePick(provider)} disabled={busy === provider}>
                            {busy === provider ? <Loader2 className="size-3.5 animate-spin mr-1" /> : <CheckCircle2 className="size-3.5 mr-1" />}
                            Save selection
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setShowPicker((s) => ({ ...s, [provider]: false }))}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 flex-wrap">
                        <Button size="sm" variant="outline" onClick={() => loadPicker(provider)} disabled={pickerBusy === provider || busy === provider}>
                          {pickerBusy === provider ? <Loader2 className="size-3.5 animate-spin mr-1" /> : <RefreshCw className="size-3.5 mr-1" />}
                          {conn.resource_label ? "Change tracked property" : "Choose property to track"}
                        </Button>
                        <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => disconnect(provider)} disabled={busy === provider}>
                          {busy === provider ? <Loader2 className="size-3.5 animate-spin mr-1" /> : <Unplug className="size-3.5 mr-1" />}
                          Disconnect
                        </Button>
                      </div>
                    )}
                  </>
                ) : (
                  <Button onClick={() => connect(provider)} disabled={busy === provider || !googleConfigured}>
                    {busy === provider ? <Loader2 className="size-4 animate-spin mr-1" /> : <Link2 className="size-4 mr-1" />}
                    Connect with Google
                  </Button>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Connections are per-tenant and stored encrypted (AES) in the database. Access tokens are
        refreshed automatically when they expire. Site traffic syncs daily into Analytics.
      </p>
    </div>
  );
}
