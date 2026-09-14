"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Trash2, MapPin, Store, ExternalLink, Star, RefreshCw, MessageSquare, BadgeCheck, AlertTriangle, Sparkles, Send, BellRing } from "lucide-react";
import type { GoogleBusinessProfile, GbpProfileReviews, GbpAlertWebhook } from "./actions";
import { getProfiles, removeProfile, listGbpReviews, draftGbpReply, replyToGbpReview, getGbpSyncStatus, syncGbpReviewsNow, listAlertWebhooks, addAlertWebhook, removeAlertWebhook, testAlertWebhook, type GbpSyncStatus } from "./actions";
import GbpBusinessPicker from "@/components/dashboard/GbpBusinessPicker";
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
  const [pickerOpen, setPickerOpen] = useState(false);

  // ---- Reviews (Lana — Reputation Manager) ----
  const [reviewsData, setReviewsData] = useState<GbpProfileReviews[] | null>(null);
  const [reviewsLoading, startReviewsLoad] = useTransition();
  // Per-review reply composer state, keyed by "profileId:reviewId". Seeded
  // from gbp_reviews.reply_text (server-persisted drafts) at render time.
  const [replyStates, setReplyStates] = useState<
    Record<string, { text: string; tone?: string; redFlags?: string[]; escalate?: boolean }>
  >({});
  const [busyReplyKey, setBusyReplyKey] = useState<string | null>(null);

  const replyKey = (profileId: string, reviewId: string) => `${profileId}:${reviewId}`;
  const [syncStatus, setSyncStatus] = useState<GbpSyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);

  // Snapshots load instantly (kept fresh by the hourly worker); a separate
  // "Sync now" button hits Google on demand, throttled server-side.
  const loadReviews = useCallback(() => {
    startReviewsLoad(async () => {
      const res = await listGbpReviews();
      if (res.success && res.data) {
        setReviewsData(res.data);
      } else {
        setReviewsData([]);
        if (res.error) setFeedback({ type: "error", message: res.error });
      }
    });
    getGbpSyncStatus().then((res) => {
      if (res.success && res.data) setSyncStatus(res.data);
    });
  }, []);

  const handleSyncNow = () => {
    setSyncing(true);
    (async () => {
      const res = await syncGbpReviewsNow();
      setSyncing(false);
      if (res.success && res.data) {
        setReviewsData(res.data.listings);
        if (res.data.throttled) {
          setFeedback({ type: "success", message: "Synced moments ago — showing the latest snapshots." });
        } else if (res.data.newReviews > 0) {
          setFeedback({ type: "success", message: `Synced — ${res.data.newReviews} new review${res.data.newReviews === 1 ? "" : "s"}.` });
        } else {
          setFeedback({ type: "success", message: "Reviews synced with Google." });
        }
        getGbpSyncStatus().then((s) => {
          if (s.success && s.data) setSyncStatus(s.data);
        });
      } else {
        setFeedback({ type: "error", message: res.error ?? "Sync failed — try again in a minute." });
      }
    })();
  };

  const handleDraftReply = (profileId: string, reviewId: string) => {
    const key = replyKey(profileId, reviewId);
    setBusyReplyKey(key);
    (async () => {
      const res = await draftGbpReply(profileId, reviewId);
      setBusyReplyKey(null);
      if (res.success && res.data) {
        setReplyStates((s) => ({
          ...s,
          [key]: {
            text: res.data!.response,
            tone: res.data!.tone,
            redFlags: res.data!.redFlags,
            escalate: res.data!.escalate,
          },
        }));
      } else {
        setFeedback({ type: "error", message: res.error ?? "Draft failed — try again." });
      }
    })();
  };

  const handlePostReply = (profileId: string, reviewId: string, text: string) => {
    if (!confirm("Post this reply publicly on Google?")) return;
    const key = replyKey(profileId, reviewId);
    setBusyReplyKey(key);
    (async () => {
      const res = await replyToGbpReview(profileId, reviewId, text);
      setBusyReplyKey(null);
      if (res.success) {
        // Optimistically flip the review to replied; the next refresh confirms
        // against Google.
        setReviewsData((data) =>
          data?.map((pr) =>
            pr.profileId === profileId
              ? {
                  ...pr,
                  reviews: pr.reviews.map((r) =>
                    r.reviewId === reviewId
                      ? { ...r, replied: true, replyComment: text, draftedReply: null }
                      : r
                  ),
                }
              : pr
          ) ?? data
        );
        setReplyStates((s) => {
          const next = { ...s };
          delete next[key];
          return next;
        });
        setFeedback({ type: "success", message: "Reply posted on Google." });
      } else {
        setFeedback({ type: "error", message: res.error ?? "Posting the reply failed." });
      }
    })();
  };

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
    loadReviews();
  }, [loadData, loadReviews]);

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

  const onConnected = (connected: GoogleBusinessProfile[]) => {
    setProfiles(connected);
    setFeedback({ type: "success", message: `Connected ${connected.length} ${connected.length === 1 ? "business" : "businesses"} from Google.` });
    loadData();
  };

  const hasConnected = profiles.some(p => p.connected);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Google Business Profile</h1>
          <p className="text-muted-foreground mt-1">Connect and manage Google Business Profile listings for your clients.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setPickerOpen(true)} disabled={isPending || !hasConnected}>
            <Store className="size-4 mr-2" /> Choose businesses
          </Button>
          <Button onClick={handleGoogleConnect} disabled={isPending} style={{ backgroundColor: "#4285F4" }}>
            {isPending ? <><Loader2 className="size-4 animate-spin mr-2" /> Connecting...</> : hasConnected ? "Reconnect (replaces existing)" : "Connect Google Account"}
          </Button>
        </div>
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
                      <div className="flex flex-wrap items-center gap-2 mt-0.5">
                        <Badge className={`text-xs ${statusBadge(profile.connected)}`}>{profile.connected ? "Connected" : "Pending"}</Badge>
                        {profile.location_name && <span className="text-xs text-muted-foreground">{profile.location_name}</span>}
                        {profile.account_email && <span className="text-xs text-muted-foreground font-mono">{profile.account_email}</span>}
                        {!profile.location_name && profile.location_id && <span className="text-xs text-muted-foreground font-mono">{profile.location_id}</span>}
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

      <GbpBusinessPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onConnected={onConnected}
        onError={(message) => setFeedback({ type: "error", message })}
      />

      {/* Reviews — Lana (Reputation Manager) */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2"><Star className="size-5 text-primary" /> Google Reviews</CardTitle>
              <CardDescription>Reviews on your connected listings, synced hourly from Google. Draft a reply with Lana and post it straight to Google.</CardDescription>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {syncStatus?.lastSyncOk && (
                <span className="text-xs text-muted-foreground">
                  Last synced {formatReviewDate(syncStatus.lastSyncOk)}
                </span>
              )}
              <Button variant="outline" size="sm" onClick={handleSyncNow} disabled={syncing || !hasConnected}>
                {syncing ? <><Loader2 className="size-4 animate-spin mr-2" /> Syncing…</> : <><RefreshCw className="size-4 mr-2" /> Sync now</>}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {!hasConnected ? (
            <p className="text-sm text-muted-foreground py-2">Connect a business above to see its Google reviews here.</p>
          ) : reviewsLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4"><Loader2 className="size-4 animate-spin" /> Loading reviews…</div>
          ) : !reviewsData ? (
            <p className="text-sm text-muted-foreground py-2">Click “Sync now” to pull the latest reviews for your connected listings.</p>
          ) : reviewsData.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">No reviews data available.</p>
          ) : (
            <div className="space-y-6">
              {reviewsData.map((pr) => (
                <div key={pr.profileId} className="space-y-3">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2 min-w-0">
                      <Store className="size-4 text-primary shrink-0" />
                      <span className="text-sm font-semibold truncate">{pr.businessName}</span>
                      {pr.averageRating != null && (
                        <span className="flex items-center gap-1 text-sm">
                          <Star className="size-4 fill-amber-400 text-amber-400" />
                          {pr.averageRating.toFixed(1)}
                        </span>
                      )}
                      {pr.totalReviewCount != null && (
                        <span className="text-xs text-muted-foreground">({pr.totalReviewCount} total)</span>
                      )}
                    </div>
                  </div>
                  {pr.error ? (
                    <p className="text-xs text-amber-600 flex items-center gap-1.5"><AlertTriangle className="size-3.5 shrink-0" /> {pr.error}</p>
                  ) : pr.reviews.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No reviews yet for this listing.</p>
                  ) : (
                    <div className="space-y-2">
                      {pr.reviews.map((review) => (
                        <div key={review.reviewId || review.createTime || review.reviewerName} className="rounded-md border p-3 space-y-1.5">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="flex items-center gap-0.5 shrink-0">
                                {[1, 2, 3, 4, 5].map((i) => (
                                  <Star
                                    key={i}
                                    className={`size-3.5 ${i <= ratingNumber(review.starRating) ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30"}`}
                                  />
                                ))}
                              </span>
                              <span className="text-sm font-medium truncate">{review.reviewerName}</span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {review.createTime && <span className="text-xs text-muted-foreground">{formatReviewDate(review.createTime)}</span>}
                              {review.replied ? (
                                <span className="inline-flex items-center gap-1 text-xs text-green-600"><BadgeCheck className="size-3.5" /> Replied</span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-xs text-amber-600"><MessageSquare className="size-3.5" /> Needs reply</span>
                              )}
                              {review.hasDraft && (
                                <span className="inline-flex items-center gap-1 text-xs text-primary"><Sparkles className="size-3.5" /> Draft ready</span>
                              )}
                            </div>
                          </div>
                          {review.comment && <p className="text-sm text-muted-foreground whitespace-pre-line">{review.comment}</p>}
                          {review.replied && review.replyComment && (
                            <p className="text-sm whitespace-pre-line border-l-2 border-primary/40 pl-3 text-foreground/80">
                              <span className="text-xs font-medium text-muted-foreground block mb-0.5">Your reply</span>
                              {review.replyComment}
                            </p>
                          )}
                          {review.internalNotes.length > 0 && (
                            <div className="space-y-1">
                              <p className="text-xs font-medium text-muted-foreground">Notes from digest replies</p>
                              {review.internalNotes.map((n, i) => (
                                <p key={i} className="text-xs text-muted-foreground border-l-2 border-primary/40 pl-2 whitespace-pre-line">{n}</p>
                              ))}
                            </div>
                          )}
                          {!review.replied && review.reviewId && (() => {
                            const key = replyKey(pr.profileId, review.reviewId);
                            const st = replyStates[key] ?? (review.draftedReply ? { text: review.draftedReply } : null);
                            const busy = busyReplyKey === key;
                            return (
                              <div className="pt-1 space-y-2">
                                {st?.text ? (
                                  <>
                                    <textarea
                                      className="w-full rounded-md border bg-background p-2 text-sm min-h-20 focus:outline-none focus:ring-1 focus:ring-ring"
                                      rows={4}
                                      maxLength={4000}
                                      value={st.text}
                                      placeholder="Public reply posted on Google…"
                                      onChange={(e) => setReplyStates((s) => ({ ...s, [key]: { ...st, text: e.target.value } }))}
                                    />
                                    {st.tone && <p className="text-xs text-muted-foreground">Tone: {st.tone}</p>}
                                    {st.escalate && (
                                      <p className="text-xs text-amber-600 flex items-center gap-1.5"><AlertTriangle className="size-3.5 shrink-0" /> Lana recommends a human sign-off before posting this one.</p>
                                    )}
                                    {st.redFlags && st.redFlags.length > 0 && (
                                      <ul className="text-xs text-amber-600 list-disc pl-4 space-y-0.5">
                                        {st.redFlags.map((f, i) => <li key={i}>{f}</li>)}
                                      </ul>
                                    )}
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <Button size="sm" disabled={busy || !st.text.trim()} onClick={() => handlePostReply(pr.profileId, review.reviewId, st.text)}>
                                        {busy ? <><Loader2 className="size-3.5 animate-spin mr-1.5" /> Posting…</> : <><Send className="size-3.5 mr-1.5" /> Post reply to Google</>}
                                      </Button>
                                      <Button size="sm" variant="outline" disabled={busy} onClick={() => handleDraftReply(pr.profileId, review.reviewId)}>
                                        <Sparkles className="size-3.5 mr-1.5" /> Regenerate
                                      </Button>
                                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => setReplyStates((s) => { const n = { ...s }; delete n[key]; return n; })}>
                                        Discard
                                      </Button>
                                    </div>
                                  </>
                                ) : (
                                  <Button size="sm" variant="outline" disabled={busy} onClick={() => handleDraftReply(pr.profileId, review.reviewId)}>
                                    {busy ? <><Loader2 className="size-3.5 animate-spin mr-1.5" /> Drafting…</> : <><Sparkles className="size-3.5 mr-1.5" /> Draft AI reply</>}
                                  </Button>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <AlertWebhooksCard />

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

/** Google starRating enum (ONE..FIVE) -> 1..5 for star rendering. */
function ratingNumber(starRating: string): number {
  const map: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
  return map[starRating] ?? 0;
}

/** Compact relative date ("12m ago", "3d ago", "Apr 2025"). */
function formatReviewDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const ms = Date.now() - d.getTime();
  if (ms < 0) return "just now";
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short" });
}
// ---------------------------------------------------------------------------
// 1-star alert webhooks — Slack/Discord/any-hook, managed inline.
// ---------------------------------------------------------------------------

const MIN_STARS_LABEL: Record<number, string> = {
  1: "1★ only",
  2: "2★ and worse",
  3: "3★ and worse",
  4: "4★ and worse",
  5: "any review",
};

function AlertWebhooksCard() {
  const [hooks, setHooks] = useState<GbpAlertWebhook[] | null>(null);
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [minStars, setMinStars] = useState(1);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(() => {
    listAlertWebhooks().then((res) => {
      setHooks(res.success && res.data ? res.data : []);
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const add = async () => {
    setBusy(true);
    setMessage(null);
    const res = await addAlertWebhook(url, label, minStars);
    setBusy(false);
    if (res.success) {
      setUrl("");
      setLabel("");
      setMessage({ ok: true, text: "Webhook saved." });
      load();
    } else {
      setMessage({ ok: false, text: res.error ?? "Save failed." });
    }
  };

  const test = async () => {
    setBusy(true);
    setMessage(null);
    const res = await testAlertWebhook(url);
    setBusy(false);
    setMessage(
      res.success
        ? { ok: true, text: "Test alert sent — check your Slack/Discord channel." }
        : { ok: false, text: res.error ?? "Test failed." }
    );
  };

  const remove = async (id: string) => {
    if (!confirm("Remove this webhook? Alerts will stop immediately.")) return;
    setBusy(true);
    const res = await removeAlertWebhook(id);
    setBusy(false);
    if (res.success) load();
    else setMessage({ ok: false, text: res.error ?? "Remove failed." });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><BellRing className="size-5 text-primary" /> 1-star review alerts</CardTitle>
        <CardDescription>
          Get an instant Slack or Discord message the moment a 1-star review lands on any connected listing.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {hooks && hooks.length > 0 && (
          <div className="space-y-2">
            {hooks.map((h) => (
              <div key={h.id} className="flex items-center justify-between gap-3 rounded-md border p-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{h.label ?? "Webhook"}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {h.webhook_masked} · triggers at {MIN_STARS_LABEL[h.min_stars ?? 1]}
                  </p>
                </div>
                <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive shrink-0 size-7" onClick={() => remove(h.id)} title="Remove webhook">
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
        <div className="space-y-2">
          <input
            className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder="https://hooks.slack.com/… or https://discord.com/api/webhooks/…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <div className="flex gap-2 flex-wrap">
            <input
              className="flex-1 min-w-40 rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder="Label (e.g. #reputation-alerts)"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
            <select
              className="rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              value={minStars}
              onChange={(e) => setMinStars(Number(e.target.value))}
            >
              <option value={1}>1★ only</option>
              <option value={2}>2★ and worse</option>
              <option value={3}>3★ and worse</option>
            </select>
          </div>
          <div className="flex gap-2">
            <Button size="sm" disabled={busy || !url.trim().startsWith("https://")} onClick={add}>
              Save webhook
            </Button>
            <Button size="sm" variant="outline" disabled={busy || !url.trim().startsWith("https://")} onClick={test}>
              Send test
            </Button>
          </div>
          {message && (
            <p className={`text-xs ${message.ok ? "text-green-600" : "text-red-500"}`}>{message.text}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
