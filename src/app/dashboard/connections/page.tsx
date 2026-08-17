"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  Link2,
  Unplug,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  BarChart3,
  Search,
  Store,
  Plus,
  Trash2,
  Users,
} from "lucide-react";
import type { GA4PropertyOption } from "@/lib/connections";
import {
  getConnections,
  initiateConnection,
  getResources,
  selectResource,
  disconnectConnection,
} from "./actions";
import type { GoogleBusinessProfile } from "../settings/gbp/actions";
import { getProfiles, removeProfile, syncGbpProfiles } from "../settings/gbp/actions";
import type { SocialAccount, OAuthConfigStatus } from "../settings/social/actions";
import {
  checkOAuthConfig,
  getSupportedPlatforms,
  getSocialAccounts,
  initiateMetaOAuth,
  initiateTwitterOAuth,
  initiateGoogleOAuth,
  initiateGoogleGbpOAuth,
  removeSocialAccount,
  addManualSocialAccount,
} from "../settings/social/actions";
import type { SocialConnectMode } from "../settings/social/constants";

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

interface PlatformInfo {
  id: string;
  name: string;
  icon: string;
  color: string;
  connectMode: SocialConnectMode;
}

const PROVIDERS: { provider: Provider; title: string; blurb: string; icon: typeof BarChart3 }[] = [
  { provider: "google_analytics", title: "Google Analytics 4", blurb: "Pull real traffic, engagement and conversion metrics into this workspace.", icon: BarChart3 },
  { provider: "search_console", title: "Search Console", blurb: "Track impressions, clicks, position and queries straight from Google.", icon: Search },
];

function socialBadgeColor(platform: string): string {
  const colors: Record<string, string> = {
    instagram: "bg-pink-100 text-pink-700 dark:bg-pink-950 dark:text-pink-300",
    facebook: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
    twitter: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
    linkedin: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
    tiktok: "bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300",
    threads: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
    youtube: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
    pinterest: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
    reddit: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
  };
  return colors[platform] ?? "bg-muted text-muted-foreground";
}

export default function ConnectionsPage() {
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  // ---- Google Analytics / Search Console ----
  const [rows, setRows] = useState<ConnectionRow[]>([]);
  const [googleConfigured, setGoogleConfigured] = useState(true);
  const [busy, setBusy] = useState<Provider | null>(null);
  const [options, setOptions] = useState<Record<Provider, ResourceOption[]>>({ google_analytics: [], search_console: [] });
  const [showPicker, setShowPicker] = useState<Record<Provider, boolean>>({ google_analytics: false, search_console: false });
  const [picked, setPicked] = useState<Record<Provider, string>>({ google_analytics: "", search_console: "" });
  const [pickerBusy, setPickerBusy] = useState<Provider | null>(null);

  // ---- Google Business Profile ----
  const [profiles, setProfiles] = useState<GoogleBusinessProfile[]>([]);
  const [oauthConfig, setOauthConfig] = useState<OAuthConfigStatus | null>(null);

  // ---- Social ----
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [platforms, setPlatforms] = useState<PlatformInfo[]>([]);
  const [connectingPlatform, setConnectingPlatform] = useState<string | null>(null);
  const [manualPlatform, setManualPlatform] = useState<string | null>(null);
  const [manualValue, setManualValue] = useState("");

  const loadConnections = useCallback(async () => {
    const res = await getConnections();
    if (!res.success) {
      setFeedback({ type: "error", message: res.error ?? "Failed to load connections" });
    } else {
      setRows(res.data ?? []);
      setGoogleConfigured(res.googleConfigured);
      for (const c of res.data ?? []) {
        if (c.selected_resource) setPicked((p) => ({ ...p, [c.provider]: c.selected_resource! }));
      }
    }
  }, []);

  const loadGbp = useCallback(async () => {
    const res = await getProfiles();
    if (res.success && res.data) setProfiles(res.data);
  }, []);

  const loadSocial = useCallback(async () => {
    const [accRes, platData, oauthConf] = await Promise.all([
      getSocialAccounts(),
      getSupportedPlatforms(),
      checkOAuthConfig(),
    ]);
    if (accRes.success && accRes.data) setAccounts(accRes.data);
    setPlatforms(platData as unknown as PlatformInfo[]);
    setOauthConfig(oauthConf);
  }, []);

  const loadAll = useCallback(() => {
    void loadConnections();
    void loadGbp();
    void loadSocial();
  }, [loadConnections, loadGbp, loadSocial]);

  useEffect(() => {
    loadAll();
    const params = new URLSearchParams(window.location.search);
    const success = params.get("success");
    const error = params.get("error");
    if (success) {
      const isGoogleData = success.includes("google_analytics") || success.includes("search_console");
      setFeedback({
        type: "success",
        message: isGoogleData
          ? success.includes("google_analytics")
            ? "Google Analytics connected. Pick which property to track."
            : "Search Console connected. Pick which site to track."
          : "Account connected successfully.",
      });
    } else if (error) {
      const messages: Record<string, string> = {
        oauth_denied: "Authorization was denied. Please try again.",
        invalid_state: "This connection link expired — please try connecting again.",
        token_exchange_failed: "Failed to complete authorization. Please try again.",
        server_error: "An unexpected error occurred. Please try again.",
      };
      setFeedback({ type: "error", message: messages[error] ?? "Connection failed: " + error });
    }
    if (success || error) window.history.replaceState({}, "", window.location.pathname);
  }, [loadAll]);

  // ---- GA4 / Search Console handlers ----
  const connect = (provider: Provider) => {
    startTransition(async () => {
      setBusy(provider);
      setFeedback(null);
      const res = await initiateConnection(provider);
      setBusy(null);
      if (!res.success || !res.data) {
        setFeedback({ type: "error", message: res.error ?? "Failed to start connection" });
        return;
      }
      window.location.href = res.data.redirectUrl;
    });
  };

  const loadPicker = (provider: Provider) => {
    startTransition(async () => {
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
          ? (res.data.options as GA4PropertyOption[]).map((p) => ({ value: p.propertyId, label: `${p.displayName} (${p.accountName})` }))
          : (res.data.options as { siteUrl: string; permissionLevel: string }[]).map((s) => ({ value: s.siteUrl, label: s.siteUrl }));
      setOptions((o) => ({ ...o, [provider]: opts }));
      setShowPicker((s) => ({ ...s, [provider]: true }));
      if (opts.length === 0) {
        setFeedback({
          type: "error",
          message: provider === "google_analytics"
            ? "No GA4 properties found on this Google account."
            : "No Search Console sites found. Verify a site in Search Console first.",
        });
      }
    });
  };

  const savePick = (provider: Provider) => {
    startTransition(async () => {
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
      await loadConnections();
    });
  };

  const disconnect = (provider: Provider) => {
    startTransition(async () => {
      if (!confirm("Disconnect this account? Analytics will stop updating until you reconnect.")) return;
      setBusy(provider);
      const res = await disconnectConnection(provider);
      setBusy(null);
      setFeedback(res.success ? { type: "success", message: "Disconnected." } : { type: "error", message: res.error ?? "Failed to disconnect" });
      await loadConnections();
    });
  };

  // ---- GBP handlers ----
  const connectGbp = () => {
    startTransition(async () => {
      const res = await initiateGoogleGbpOAuth();
      if (res.success && res.redirectUrl) {
        window.location.href = res.redirectUrl;
      } else {
        setFeedback({ type: "error", message: res.error ?? "Failed to initiate Google connection." });
      }
    });
  };

  const refreshGbp = () => {
    startTransition(async () => {
      setFeedback(null);
      const res = await syncGbpProfiles();
      if (res.success) {
        if (res.data) setProfiles(res.data);
        setFeedback({ type: "success", message: `Refreshed from Google — ${res.data?.length ?? 0} profile(s) found.` });
      } else {
        setFeedback({ type: "error", message: res.error ?? "Refresh failed." });
      }
    });
  };

  const removeGbp = (id: string, name: string) => {
    startTransition(async () => {
      if (!confirm(`Remove "${name}"?`)) return;
      const res = await removeProfile(id);
      if (res.success) {
        setFeedback({ type: "success", message: `${name} removed.` });
        await loadGbp();
      } else {
        setFeedback({ type: "error", message: res.error ?? "Failed." });
      }
    });
  };

  // ---- Social handlers ----
  const connectSocial = (platform: PlatformInfo) => {
    startTransition(async () => {
      setConnectingPlatform(platform.id);
      setFeedback(null);
      try {
        let res: { success: boolean; redirectUrl?: string; error?: string } | null = null;
        if (platform.connectMode === "meta") {
          res = await initiateMetaOAuth(platform.id as "facebook" | "instagram");
        } else if (platform.connectMode === "twitter") {
          res = await initiateTwitterOAuth();
        } else if (platform.connectMode === "google") {
          res = await initiateGoogleOAuth("youtube");
        }
        if (res?.success && res.redirectUrl) {
          window.location.href = res.redirectUrl;
        } else {
          setFeedback({ type: "error", message: res?.error ?? "Failed to initiate connection" });
        }
      } catch {
        setFeedback({ type: "error", message: "An unexpected error occurred" });
      } finally {
        setConnectingPlatform(null);
      }
    });
  };

  const submitManual = (platformId: string) => {
    startTransition(async () => {
      const value = manualValue.trim();
      if (!value) {
        setFeedback({ type: "error", message: "Enter the account name or handle first." });
        return;
      }
      const res = await addManualSocialAccount(platformId, value);
      if (res.success) {
        setFeedback({ type: "success", message: "Account added." });
        setManualPlatform(null);
        setManualValue("");
        await loadSocial();
      } else {
        setFeedback({ type: "error", message: res.error ?? "Failed to add account." });
      }
    });
  };

  const removeSocial = (id: string, name: string) => {
    startTransition(async () => {
      if (!confirm(`Remove "${name}"?`)) return;
      const res = await removeSocialAccount(id);
      if (res.success) {
        setFeedback({ type: "success", message: `${name} removed.` });
        await loadSocial();
      } else {
        setFeedback({ type: "error", message: res.error ?? "Failed to remove account." });
      }
    });
  };

  const connectedPlatforms = new Set(accounts.map((a) => a.platform));
  const accountsFor = (platformId: string) => accounts.filter((a) => a.platform === platformId);
  const hasGbpConnected = profiles.some((p) => p.connected);
  const oauthWarnings: string[] = [];
  if (oauthConfig) {
    if (!oauthConfig.metaConfigured) oauthWarnings.push("Meta (Facebook/Instagram) needs NEXT_PUBLIC_META_APP_ID + META_APP_SECRET");
    if (!oauthConfig.twitterConfigured) oauthWarnings.push("X (Twitter) needs TWITTER_CLIENT_ID + TWITTER_CLIENT_SECRET");
    if (!oauthConfig.googleConfigured) oauthWarnings.push("Google (Analytics, Search Console, YouTube, Business Profile) needs GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET");
  }

  return (
    <div className="space-y-8 max-w-6xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Link2 className="size-7 text-primary" /> Connections
        </h1>
        <p className="text-muted-foreground mt-1">
          Onboard every account this workspace needs — Google data sources, Google Business Profile, and social channels — all in one place. Connections are stored per workspace and never shared between clients.
        </p>
      </div>

      {feedback && (
        <div className={`p-3 rounded-md text-sm border ${feedback.type === "success" ? "bg-green-50 text-green-700 border-green-200" : "bg-red-50 text-red-700 border-red-200"}`} role="alert">
          {feedback.message}
          <button className="ml-3 underline text-xs" onClick={() => setFeedback(null)}>Dismiss</button>
        </div>
      )}

      {oauthWarnings.length > 0 && (
        <div className="p-4 rounded-md border border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-100 text-sm space-y-1">
          <p className="font-medium flex items-center gap-2"><AlertTriangle className="size-4" /> OAuth is not fully configured on this deployment</p>
          {oauthWarnings.map((w) => (
            <p key={w} className="text-xs">• {w}</p>
          ))}
        </div>
      )}

      {/* ---------------- Google ---------------- */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <BarChart3 className="size-5 text-primary" /> Google
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {PROVIDERS.map(({ provider, title, blurb, icon: Icon }) => {
            const conn = rows.find((r) => r.provider === provider);
            return (
              <Card key={provider} className="p-5 flex flex-col gap-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="size-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                      <Icon className="size-5" />
                    </div>
                    <div>
                      <h3 className="font-semibold leading-tight">{title}</h3>
                      <p className="text-xs text-muted-foreground">{blurb}</p>
                    </div>
                  </div>
                  {conn?.connected ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600 shrink-0"><CheckCircle2 className="size-4" /> Connected</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground shrink-0"><span className="size-2 rounded-full bg-muted-foreground/50" /> Not connected</span>
                  )}
                </div>

                {conn?.connected ? (
                  <>
                    <div className="text-sm space-y-1 bg-muted/30 rounded-md p-3">
                      <div className="font-medium">{conn.account_name ?? "Google account"}</div>
                      {conn.account_email && <div className="text-xs text-muted-foreground">{conn.account_email}</div>}
                      {conn.resource_label ? (
                        <div className="text-xs text-primary mt-1">Tracking: {conn.resource_label}</div>
                      ) : (
                        <div className="text-xs text-amber-600 mt-1">No property selected yet — choose what to track below.</div>
                      )}
                    </div>
                    {showPicker[provider] ? (
                      <div className="space-y-2">
                        <select value={picked[provider]} onChange={(e) => setPicked((p) => ({ ...p, [provider]: e.target.value }))} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                          <option value="">{provider === "google_analytics" ? "Select a GA4 property…" : "Select a site…"}</option>
                          {options[provider].map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                        <div className="flex items-center gap-2">
                          <Button size="sm" onClick={() => savePick(provider)} disabled={busy === provider}>
                            {busy === provider ? <Loader2 className="size-3.5 animate-spin mr-1" /> : <CheckCircle2 className="size-3.5 mr-1" />} Save selection
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setShowPicker((s) => ({ ...s, [provider]: false }))}>Cancel</Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 flex-wrap">
                        <Button size="sm" variant="outline" onClick={() => loadPicker(provider)} disabled={pickerBusy === provider || busy === provider}>
                          {pickerBusy === provider ? <Loader2 className="size-3.5 animate-spin mr-1" /> : <RefreshCw className="size-3.5 mr-1" />}
                          {conn.resource_label ? "Change tracked property" : "Choose property to track"}
                        </Button>
                        <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => disconnect(provider)} disabled={busy === provider}>
                          {busy === provider ? <Loader2 className="size-3.5 animate-spin mr-1" /> : <Unplug className="size-3.5 mr-1" />} Disconnect
                        </Button>
                      </div>
                    )}
                  </>
                ) : (
                  <Button onClick={() => connect(provider)} disabled={busy === provider || !googleConfigured}>
                    {busy === provider ? <Loader2 className="size-4 animate-spin mr-1" /> : <Link2 className="size-4 mr-1" />} Connect with Google
                  </Button>
                )}
              </Card>
            );
          })}
        </div>

        {/* Google Business Profile */}
        <Card className="p-5">
          <CardHeader className="p-0 pb-4">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Store className="size-5 text-primary" /> Google Business Profile
            </CardTitle>
            <CardDescription>Connect your business listings so reviews, posts and local presence can be managed per workspace.</CardDescription>
          </CardHeader>
          <CardContent className="p-0 space-y-4">
            <div className="flex items-center gap-2 flex-wrap">
              <Button size="sm" onClick={connectGbp} disabled={isPending || !oauthConfig?.googleBusinessConfigured} style={{ backgroundColor: "#4285F4" }}>
                {isPending ? <><Loader2 className="size-4 animate-spin mr-1" /> Connecting…</> : hasGbpConnected ? "Reconnect (replaces existing)" : "Connect Google Account"}
              </Button>
              <Button size="sm" variant="outline" onClick={refreshGbp} disabled={isPending || !hasGbpConnected}>
                {isPending ? <Loader2 className="size-4 animate-spin mr-1" /> : <RefreshCw className="size-4 mr-1" />} Refresh from Google
              </Button>
            </div>
            {profiles.length === 0 ? (
              <p className="text-sm text-muted-foreground">No Google Business Profiles connected yet.</p>
            ) : (
              <div className="divide-y rounded-md border">
                {profiles.map((profile) => (
                  <div key={profile.id} className="flex items-center justify-between py-3 px-3 gap-4 flex-wrap">
                    <div className="flex items-center gap-3 min-w-0">
                      <Store className="size-5 text-primary shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{profile.account_name}</p>
                        <div className="flex flex-wrap items-center gap-2 mt-0.5">
                          <Badge className={`text-xs ${profile.connected ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"}`}>{profile.connected ? "Connected" : "Pending"}</Badge>
                          {profile.location_name && <span className="text-xs text-muted-foreground">{profile.location_name}</span>}
                          {profile.account_email && <span className="text-xs text-muted-foreground font-mono">{profile.account_email}</span>}
                        </div>
                      </div>
                    </div>
                    <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive shrink-0" onClick={() => removeGbp(profile.id, profile.account_name)} disabled={isPending}>
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {/* ---------------- Social ---------------- */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Users className="size-5 text-primary" /> Social accounts
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {platforms.map((p) => {
            const connected = connectedPlatforms.has(p.id);
            const list = accountsFor(p.id);
            const isConnecting = connectingPlatform === p.id;
            const isManual = p.connectMode === "manual";
            const isManualOpen = manualPlatform === p.id;
            return (
              <Card key={p.id} className="p-4 flex flex-col gap-3">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{p.icon}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{p.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {connected ? `${list.length} connected` : isManual ? "Add manually" : "Connect via OAuth"}
                    </p>
                  </div>
                  {connected && <Badge className="text-xs bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300">Connected</Badge>}
                </div>

                {list.map((acc) => (
                  <div key={acc.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
                    <span className="text-xs font-medium truncate">{acc.account_name}</span>
                    <Badge className={`text-[10px] ${socialBadgeColor(acc.platform)}`}>{p.name}</Badge>
                    <button className="text-muted-foreground hover:text-destructive shrink-0" onClick={() => removeSocial(acc.id, acc.account_name)} disabled={isPending}>
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                ))}

                {isManualOpen ? (
                  <div className="space-y-2">
                    <Input placeholder="Account name, handle or URL" value={manualValue} onChange={(e) => setManualValue(e.target.value)} disabled={isPending} />
                    <div className="flex items-center gap-2">
                      <Button size="sm" onClick={() => submitManual(p.id)} disabled={isPending || !manualValue.trim()}>
                        {isPending ? <Loader2 className="size-3.5 animate-spin mr-1" /> : <Plus className="size-3.5 mr-1" />} Add
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => { setManualPlatform(null); setManualValue(""); }}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant={connected ? "secondary" : "default"}
                    onClick={() => (isManual ? setManualPlatform(p.id) : connectSocial(p))}
                    disabled={isPending || isConnecting || (connected && !isManual)}
                    style={!connected && !isManual ? { backgroundColor: p.color, borderColor: p.color } : undefined}
                  >
                    {isConnecting ? <Loader2 className="size-3.5 animate-spin mr-1" /> : isManual ? <Plus className="size-3.5 mr-1" /> : <Link2 className="size-3.5 mr-1" />}
                    {isManual ? (connected ? "Add another" : "Add account") : connected ? "Connected" : "Connect"}
                  </Button>
                )}
              </Card>
            );
          })}
        </div>
      </section>

      <p className="text-xs text-muted-foreground">
        Connections are stored per workspace and encrypted at rest. Access tokens are refreshed automatically when they expire. Google Analytics and Search Console sync daily into Analytics.
      </p>
    </div>
  );
}
