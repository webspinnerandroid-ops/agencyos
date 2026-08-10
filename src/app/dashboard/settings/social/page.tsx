"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  Trash2,
  Link2,
  Users,
} from "lucide-react";

import type { SocialAccount, OAuthConfigStatus } from "./actions";
import {
  checkOAuthConfig,
  getSupportedPlatforms,
  getSocialAccounts,
  initiateMetaOAuth,
  initiateTwitterOAuth,
  initiateGoogleOAuth,
  removeSocialAccount,
} from "./actions";

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function platformBadgeColor(platform: string): string {
  const colors: Record<string, string> = {
    instagram: "bg-pink-100 text-pink-700 dark:bg-pink-950 dark:text-pink-300",
    facebook: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
    twitter: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
    linkedin: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
    tiktok: "bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300",
    threads: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
    youtube: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
    pinterest: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
  };
  return colors[platform] ?? "bg-muted text-muted-foreground";
}

// ------------------------------------------------------------------
// Page
// ------------------------------------------------------------------

export default function SocialAccountsPage() {
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [platforms, setPlatforms] = useState<{ id: string; name: string; icon: string; color: string; oauth: boolean }[]>([]);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [isLoading, startLoading] = useTransition();
  const [isPending, startTransition] = useTransition();
  const [connectingPlatform, setConnectingPlatform] = useState<string | null>(null);
  const [oauthConfig, setOauthConfig] = useState<OAuthConfigStatus | null>(null);

  const loadData = useCallback(() => {
    startLoading(async () => {
      const [accRes, platData, oauthConf] = await Promise.all([
        getSocialAccounts(),
        getSupportedPlatforms(),
        checkOAuthConfig(),
      ]);
      if (accRes.success && accRes.data) setAccounts(accRes.data);
      setPlatforms(platData as any);
      setOauthConfig(oauthConf);
    });
  }, []);

  useEffect(() => {
    // Check for error/success from OAuth callback redirect
    const params = new URLSearchParams(window.location.search);
    const success = params.get("success");
    const error = params.get("error");
    if (success === "connected") {
      setFeedback({ type: "success", message: "Account connected successfully!" });
      window.history.replaceState({}, "", "/dashboard/settings/social");
    } else if (error) {
      const messages: Record<string, string> = {
        oauth_denied: "Authorization was denied. Please try again.",
        invalid_state: "Session expired. Please try connecting again.",
        token_exchange_failed: "Failed to complete authorization. Please try again.",
        server_error: "An unexpected error occurred. Please try again.",
      };
      setFeedback({ type: "error", message: messages[error] ?? "Connection failed: " + error });
      window.history.replaceState({}, "", "/dashboard/settings/social");
    }
    loadData();
  }, [loadData]);

  const connectedPlatforms = new Set(accounts.map((a) => a.platform));

  const handleOAuthConnect = (platformId: string) => {
    startTransition(async () => {
      setConnectingPlatform(platformId);
      try {
        if (platformId === "facebook" || platformId === "instagram") {
          const res = await initiateMetaOAuth(platformId as "facebook" | "instagram");
          if (res.success && res.redirectUrl) {
            window.location.href = res.redirectUrl;
          } else {
            setFeedback({ type: "error", message: res.error ?? "Failed to initiate connection" });
          }
        } else if (platformId === "twitter") {
          const res = await initiateTwitterOAuth();
          if (res.success && res.redirectUrl) {
            window.location.href = res.redirectUrl;
          } else {
            setFeedback({ type: "error", message: res.error ?? "Failed to initiate connection" });
          }
        } else if (platformId === "youtube") {
          const res = await initiateGoogleOAuth("youtube");
          if (res.success && res.redirectUrl) {
            window.location.href = res.redirectUrl;
          } else {
            setFeedback({ type: "error", message: res.error ?? "Failed to initiate connection" });
          }
        }
      } catch {
        setFeedback({ type: "error", message: "An unexpected error occurred" });
      } finally {
        setConnectingPlatform(null);
      }
    });
  };

  const handleRemove = (accountId: string, accountName: string) => {
    if (!confirm(`Remove "${accountName}"? Posts scheduled for this account will no longer publish.`)) return;
    startTransition(async () => {
      const res = await removeSocialAccount(accountId);
      if (res.success) {
        setFeedback({ type: "success", message: `${accountName} removed.` });
        loadData();
      } else {
        setFeedback({ type: "error", message: res.error ?? "Failed to remove account." });
      }
    });
  };

  const oauthPlatforms = platforms.filter(p => p.oauth);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Social Accounts</h1>
          <p className="text-muted-foreground mt-1">
            Connect your social media accounts so content can be published directly.
          </p>
        </div>
      </div>

      {feedback && (
        <div className={`p-3 rounded-md text-sm font-medium ${
          feedback.type === "success"
            ? "bg-green-50 text-green-700 border border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800"
            : "bg-red-50 text-red-700 border border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800"
        }`} role="alert">
          {feedback.message}
          <button className="ml-3 underline text-xs" onClick={() => setFeedback(null)}>Dismiss</button>
        </div>
      )}

      {/* OAuth Configuration Warnings */}
      {oauthConfig && oauthConfig.missingEnvVars.length > 0 && (
        <div className="p-4 rounded-md bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800">
          <p className="text-sm font-medium mb-2">⚠️ OAuth providers require environment variables to be configured:</p>
          <ul className="list-disc list-inside text-xs space-y-1">
            {!oauthConfig.metaConfigured && (
              <li>Meta (Facebook/Instagram): Set <code className="bg-amber-100 dark:bg-amber-900 px-1 rounded">NEXT_PUBLIC_META_APP_ID</code> and <code className="bg-amber-100 dark:bg-amber-900 px-1 rounded">META_APP_SECRET</code> in <code className="bg-amber-100 dark:bg-amber-900 px-1 rounded">.env.local</code></li>
            )}
            {!oauthConfig.twitterConfigured && (
              <li>Twitter/X: Set <code className="bg-amber-100 dark:bg-amber-900 px-1 rounded">TWITTER_CLIENT_ID</code> and <code className="bg-amber-100 dark:bg-amber-900 px-1 rounded">TWITTER_CLIENT_SECRET</code> in <code className="bg-amber-100 dark:bg-amber-900 px-1 rounded">.env.local</code></li>
            )}
            {!oauthConfig.googleConfigured && (
              <li>Google (YouTube, GBP): Set <code className="bg-amber-100 dark:bg-amber-900 px-1 rounded">GOOGLE_CLIENT_ID</code> and <code className="bg-amber-100 dark:bg-amber-900 px-1 rounded">GOOGLE_CLIENT_SECRET</code> in <code className="bg-amber-100 dark:bg-amber-900 px-1 rounded">.env.local</code></li>
            )}
          </ul>
          <p className="text-xs mt-2 opacity-70">To fix these, add the missing variables to your <code className="bg-amber-100 dark:bg-amber-900 px-1 rounded">.env.local</code> file on the server and restart the application.</p>
        </div>
      )}

      {/* OAuth Connect Buttons */}
      {oauthPlatforms.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Link2 className="size-5 text-primary" />
              Connect with OAuth
            </CardTitle>
            <CardDescription>
              Click a platform below to connect securely via OAuth. You'll be redirected to the platform to authorize access.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {oauthPlatforms.map((p) => {
                const isConnected = connectedPlatforms.has(p.id);
                const isConnecting = connectingPlatform === p.id;
                return (
                  <Button
                    key={p.id}
                    variant={isConnected ? "secondary" : "default"}
                    className="h-auto py-4 px-5 justify-start gap-3"
                    disabled={isConnected || isPending}
                    onClick={() => handleOAuthConnect(p.id)}
                    style={!isConnected ? { backgroundColor: p.color, borderColor: p.color } : undefined}
                  >
                    <span className="text-2xl">{p.icon}</span>
                    <span className="flex-1 text-left">
                      <span className="block font-semibold">{isConnected ? `✓ ${p.name}` : p.name}</span>
                      <span className="block text-xs opacity-80">
                        {isConnected ? "Already connected" : isConnecting ? "Redirecting..." : "Click to connect"}
                      </span>
                    </span>
                    {isConnecting && <Loader2 className="size-4 animate-spin ml-auto" />}
                  </Button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Connected accounts list */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="size-5 text-primary" />
            Connected Accounts
          </CardTitle>
          <CardDescription>
            Accounts you've connected. Content will publish to these platforms when scheduled.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <Loader2 className="size-4 animate-spin" /> Loading accounts...
            </div>
          ) : accounts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Link2 className="size-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No accounts connected yet.</p>
              <p className="text-xs mt-1">Use the OAuth buttons above to securely connect your social platforms.</p>
            </div>
          ) : (
            <div className="divide-y">
              {accounts.map((account) => {
                const platformInfo = platforms.find((p) => p.id === account.platform);
                return (
                  <div key={account.id} className="flex items-center justify-between py-4 gap-4 flex-wrap">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-2xl">{platformInfo?.icon ?? "🔗"}</span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{account.account_name}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <Badge className={`text-xs ${platformBadgeColor(account.platform)}`}>
                            {platformInfo?.name ?? account.platform}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            Added {new Date(account.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                          </span>
                        </div>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-destructive shrink-0"
                      onClick={() => handleRemove(account.id, account.account_name)}
                      disabled={isPending}
                      aria-label={`Remove ${account.account_name}`}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}