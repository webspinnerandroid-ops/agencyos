"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Trash2, MapPin, Store, ExternalLink } from "lucide-react";
import type { GoogleBusinessProfile } from "./actions";
import { getProfiles, removeProfile } from "./actions";
import { initiateGoogleGbpOAuth, checkOAuthConfig, type OAuthConfigStatus } from "../social/actions";

function statusBadge(connected: boolean) {
  return connected
    ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300"
    : "bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300";
}

export default function GbpPage() {
  const [profiles, setProfiles] = useState<GoogleBusinessProfile[]>([]);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [isLoading, startLoading] = useTransition();
  const [isPending, startTransition] = useTransition();
  const [oauthConfig, setOauthConfig] = useState<OAuthConfigStatus | null>(null);

  const loadData = useCallback(() => {
    startLoading(async () => {
      const [profRes, oauthConf] = await Promise.all([
        getProfiles(),
        checkOAuthConfig(),
      ]);
      if (profRes.success && profRes.data) setProfiles(profRes.data);
      setOauthConfig(oauthConf);
    });
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const success = params.get("success");
    const error = params.get("error");
    if (success === "connected") {
      setFeedback({ type: "success", message: "Google Business Profile connected successfully!" });
      window.history.replaceState({}, "", "/dashboard/settings/gbp");
    } else if (error) {
      const messages: Record<string, string> = {
        oauth_denied: "Authorization was denied. Please try again.",
        invalid_state: "Session expired. Please try connecting again.",
        token_exchange_failed: "Failed to complete authorization. Please try again.",
        server_error: "An unexpected error occurred. Please try again.",
      };
      setFeedback({ type: "error", message: messages[error] ?? "Connection failed: " + error });
      window.history.replaceState({}, "", "/dashboard/settings/gbp");
    }
    loadData();
  }, [loadData]);

  const handleGoogleConnect = () => {
    startTransition(async () => {
      const res = await initiateGoogleGbpOAuth();
      if (res.success && res.redirectUrl) {
        window.location.href = res.redirectUrl;
      } else {
        setFeedback({ type: "error", message: res.error ?? "Failed to initiate Google connection. Ensure GOOGLE_CLIENT_ID is configured." });
      }
    });
  };

  const handleRemove = (profileId: string, name: string) => {
    if (!confirm(`Remove "${name}"?`)) return;
    startTransition(async () => {
      const res = await removeProfile(profileId);
      if (res.success) { setFeedback({ type: "success", message: `${name} removed.` }); loadData(); }
      else { setFeedback({ type: "error", message: res.error ?? "Failed." }); }
    });
  };

  const hasConnected = profiles.some(p => p.connected);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Google Business Profile</h1>
          <p className="text-muted-foreground mt-1">Connect and manage Google Business Profile listings for your clients.</p>
        </div>
        <Button onClick={handleGoogleConnect} disabled={isPending || hasConnected} style={{ backgroundColor: "#4285F4" }}>
          {isPending ? <><Loader2 className="size-4 animate-spin mr-2" /> Connecting...</> : hasConnected ? "✓ Connected" : "Connect Google Account"}
        </Button>
      </div>

      {feedback && (
        <div className={`p-3 rounded-md text-sm font-medium ${feedback.type === "success" ? "bg-green-50 text-green-700 border border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800" : "bg-red-50 text-red-700 border border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800"}`} role="alert">
          {feedback.message}
          <button className="ml-3 underline text-xs" onClick={() => setFeedback(null)}>Dismiss</button>
        </div>
      )}

      {/* OAuth Configuration Warning for GBP */}
      {oauthConfig && !oauthConfig.googleBusinessConfigured && (
        <div className="p-4 rounded-md bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800">
          <p className="text-sm font-medium">⚠️ Google OAuth not configured</p>
          <p className="text-xs mt-1">
            Set <code className="bg-amber-100 dark:bg-amber-900 px-1 rounded">GOOGLE_CLIENT_ID</code> and{" "}
            <code className="bg-amber-100 dark:bg-amber-900 px-1 rounded">GOOGLE_CLIENT_SECRET</code> in{" "}
            <code className="bg-amber-100 dark:bg-amber-900 px-1 rounded">.env.local</code> to enable Google Business Profile connections.
          </p>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><MapPin className="size-5 text-primary" /> Connected Profiles</CardTitle>
          <CardDescription>Google Business Profile listings connected to this account.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4"><Loader2 className="size-4 animate-spin" /> Loading...</div>
          ) : profiles.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Store className="size-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No Google Business Profiles connected yet.</p>
              <p className="text-xs mt-1">Click &ldquo;Connect Google Account&rdquo; to sign in with Google OAuth.</p>
            </div>
          ) : (
            <div className="divide-y">
              {profiles.map((profile) => (
                <div key={profile.id} className="flex items-center justify-between py-4 gap-4 flex-wrap">
                  <div className="flex items-center gap-3 min-w-0">
                    <Store className="size-5 text-primary shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{profile.account_name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge className={`text-xs ${statusBadge(profile.connected)}`}>{profile.connected ? "Connected" : "Pending"}</Badge>
                        <span className="text-xs text-muted-foreground font-mono">{profile.location_id ?? "N/A"}</span>
                        {(profile as any).client?.name && <span className="text-xs text-muted-foreground">• Client: {(profile as any).client.name}</span>}
                      </div>
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive shrink-0" onClick={() => handleRemove(profile.id, profile.account_name)} disabled={isPending}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Store className="size-5 text-primary" /> Setup Guide</CardTitle>
          <CardDescription>Prerequisites for connecting your Google Business Profile.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm space-y-3">
          <ol className="list-decimal pl-5 space-y-2 text-muted-foreground">
            <li>Go to <a href="https://console.cloud.google.com" target="_blank" rel="noopener noreferrer" className="text-primary underline">Google Cloud Console <ExternalLink className="size-3 inline" /></a></li>
            <li>Create a project and enable the <strong>My Business API</strong></li>
            <li>Create OAuth 2.0 credentials with redirect URI: <code className="text-xs">{process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"}/api/auth/callback/google</code></li>
            <li>Set <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code> in your <code>.env.local</code></li>
            <li>Click &ldquo;Connect Google Account&rdquo; above to authorize access</li>
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}