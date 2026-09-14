"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Loader2, Star, MessageSquare, Sparkles, Store, AlertTriangle, RefreshCw, Send, Trash2, X, Mail } from "lucide-react";
import type { ReputationOverview } from "./actions";
import { getReputationOverview } from "./actions";
import { replyToGbpReview, discardGbpReply } from "@/app/dashboard/settings/gbp/actions";

export default function ReputationPage() {
  const [overview, setOverview] = useState<ReputationOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [isLoading, startLoad] = useTransition();

  const load = () => {
    startLoad(async () => {
      const res = await getReputationOverview();
      if (res.success && res.data) {
        setOverview(res.data);
        setError(null);
      } else {
        setError(res.error ?? "Failed to load reputation data.");
      }
    });
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Reputation</h1>
          <p className="text-muted-foreground mt-1">
            Google review trends, volume, and reply status across every connected listing.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={load} disabled={isLoading}>
            {isLoading ? <Loader2 className="size-4 animate-spin mr-2" /> : <RefreshCw className="size-4 mr-2" />} Refresh
          </Button>
          <Button variant="outline" onClick={() => { window.location.href = "/dashboard/settings/gbp"; }}>
            <Sparkles className="size-4 mr-2" /> Manage reviews & replies
          </Button>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-md text-sm font-medium bg-red-50 text-red-700 border border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800" role="alert">
          {error}
          <button className="ml-3 underline text-xs" onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      {feedback && (
        <div className={`p-3 rounded-md text-sm font-medium ${feedback.type === "success" ? "bg-green-50 text-green-700 border border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800" : "bg-red-50 text-red-700 border border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800"}`} role="alert">
          {feedback.message}
          <button className="ml-3 underline text-xs" onClick={() => setFeedback(null)}>Dismiss</button>
        </div>
      )}

      {isLoading && !overview ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
          <Loader2 className="size-4 animate-spin" /> Loading reputation data…
        </div>
      ) : !overview ? null : overview.listings.length === 0 ? (
        <Card>
          <CardContent className="text-center py-12">
            <Store className="size-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No Google Business Profiles connected yet.</p>
            <p className="text-xs mt-1 text-muted-foreground">
              Connect a business in{" "}
              <a href="/dashboard/settings/gbp" className="text-primary underline">
                Settings → Google Business Profile
              </a>{" "}
              and its reviews will show up here after the first sync.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <PortfolioCards overview={overview} />
          <ReplyQueue items={overview.replyQueue} onChanged={load} onFeedback={(m) => setFeedback(m)} />
          <div className="grid gap-6 lg:grid-cols-2">
            <MonthlyChart monthly={overview.monthly} />
            <StarHistogram histogram={overview.starHistogram} weightedRating={overview.weightedRating} />
          </div>
          <ListingTable listings={overview.listings} />
          <DigestNotesCard items={overview.digestNotes} />
        </>
      )}
    </div>
  );
}

function PortfolioCards({ overview }: { overview: ReputationOverview }) {
  const cards = [
    {
      label: "Avg rating (stored window)",
      value: overview.weightedRating != null ? `${overview.weightedRating}★` : "—",
      hint: overview.windowTruncated ? "Google's per-listing averages below are authoritative" : undefined,
    },
    {
      label: "Reviews tracked",
      value: String(overview.totalReviews),
      hint: overview.windowTruncated ? "latest ~50 per listing" : undefined,
    },
    {
      label: "Awaiting reply",
      value: String(overview.totalUnanswered),
      accent: overview.totalUnanswered > 0 ? "text-amber-600" : undefined,
    },
    {
      label: "Lana drafts ready",
      value: String(overview.totalDraftsWaiting),
      accent: overview.totalDraftsWaiting > 0 ? "text-primary" : undefined,
    },
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((c) => (
        <Card key={c.label}>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground">{c.label}</p>
            <p className={`text-2xl font-bold mt-1 ${c.accent ?? ""}`}>{c.value}</p>
            {c.hint && <p className="text-[11px] text-muted-foreground mt-1">{c.hint}</p>}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function MonthlyChart({ monthly }: { monthly: ReputationOverview["monthly"] }) {
  const max = Math.max(1, ...monthly.map((m) => m.count));
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><MessageSquare className="size-5 text-primary" /> Review volume</CardTitle>
        <CardDescription>Reviews per month, last 6 months (all listings)</CardDescription>
      </CardHeader>
      <CardContent>
        {monthly.every((m) => m.count === 0) ? (
          <p className="text-sm text-muted-foreground py-6 text-center">No reviews in the tracked window yet.</p>
        ) : (
          <div>
            <div className="flex items-end gap-3 h-40">
              {monthly.map((m) => (
                <div key={m.month} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end">
                  <span className="text-xs font-medium">{m.count > 0 ? m.count : ""}</span>
                  <div
                    className="w-full rounded-t bg-primary/80"
                    style={{ height: `${Math.max(2, (m.count / max) * 100)}%` }}
                    title={`${m.count} reviews${m.avgRating != null ? ` · avg ${m.avgRating}★` : ""}`}
                  />
                </div>
              ))}
            </div>
            <div className="flex gap-3 mt-2">
              {monthly.map((m) => (
                <div key={m.month} className="flex-1 text-center">
                  <p className="text-xs text-muted-foreground">{m.month}</p>
                  <p className="text-[11px] text-muted-foreground">{m.avgRating != null ? `${m.avgRating}★` : " "}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StarHistogram({
  histogram,
  weightedRating,
}: {
  histogram: number[];
  weightedRating: number | null;
}) {
  const total = Math.max(1, histogram.reduce((s, n) => s + n, 0));
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Star className="size-5 text-primary" /> Rating breakdown</CardTitle>
        <CardDescription>
          Star distribution across tracked reviews{weightedRating != null ? ` · average ${weightedRating}★` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {[5, 4, 3, 2, 1].map((stars) => {
          const count = histogram[stars - 1];
          return (
            <div key={stars} className="flex items-center gap-3">
              <span className="flex items-center gap-1 text-xs w-10 shrink-0">
                {stars} <Star className="size-3 fill-amber-400 text-amber-400" />
              </span>
              <div className="flex-1 h-2.5 rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full rounded-full ${stars >= 4 ? "bg-green-500" : stars === 3 ? "bg-amber-400" : "bg-red-400"}`}
                  style={{ width: `${(count / total) * 100}%` }}
                />
              </div>
              <span className="text-xs text-muted-foreground w-8 text-right">{count}</span>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function ListingTable({ listings }: { listings: ReputationOverview["listings"] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Store className="size-5 text-primary" /> Listings</CardTitle>
        <CardDescription>Per-listing reputation snapshot. Ratings come from Google's own aggregates.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b">
                <th className="py-2 pr-4 font-medium">Business</th>
                <th className="py-2 pr-4 font-medium">Rating</th>
                <th className="py-2 pr-4 font-medium">12-week trend</th>
                <th className="py-2 pr-4 font-medium">Tracked</th>
                <th className="py-2 pr-4 font-medium">Awaiting reply</th>
                <th className="py-2 pr-4 font-medium">Drafts ready</th>
                <th className="py-2 pr-4 font-medium">Last review</th>
              </tr>
            </thead>
            <tbody>
              {listings.map((l) => (
                <tr key={l.profileId} className="border-b last:border-0">
                  <td className="py-2.5 pr-4 font-medium">{l.businessName}</td>
                  <td className="py-2.5 pr-4">
                    {l.averageRating != null ? (
                      <span className="inline-flex items-center gap-1">
                        <Star className="size-3.5 fill-amber-400 text-amber-400" />
                        {l.averageRating.toFixed(1)}
                        {l.totalReviewCount != null && (
                          <span className="text-xs text-muted-foreground">({l.totalReviewCount})</span>
                        )}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="py-2.5 pr-4"><Sparkline data={l.sparkline} /></td>
                  <td className="py-2.5 pr-4 text-muted-foreground">{l.storedReviews}</td>
                  <td className="py-2.5 pr-4">
                    {l.unanswered > 0 ? (
                      <span className="inline-flex items-center gap-1 text-amber-600">
                        <MessageSquare className="size-3.5" /> {l.unanswered}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-green-600">✓ 0</span>
                    )}
                  </td>
                  <td className="py-2.5 pr-4">
                    {l.draftsWaiting > 0 ? (
                      <span className="inline-flex items-center gap-1 text-primary">
                        <Sparkles className="size-3.5" /> {l.draftsWaiting}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </td>
                  <td className="py-2.5 pr-4 text-muted-foreground">
                    {l.lastReviewAt ? formatReviewDate(l.lastReviewAt) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {overviewWindowNote(listings) && (
          <p className="text-xs text-muted-foreground mt-4 flex items-center gap-1.5">
            <AlertTriangle className="size-3.5 shrink-0" />
            Some listings have 50+ tracked reviews — the monthly chart counts only the latest ~50 per listing.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function overviewWindowNote(listings: ReputationOverview["listings"]): boolean {
  return listings.some((l) => l.storedReviews >= 50);
}

// ---------------------------------------------------------------------------
// Reply queue — Lana's waiting drafts with approve-and-post.
// ---------------------------------------------------------------------------

const QUEUE_STARS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

function ReplyQueue({
  items,
  onChanged,
  onFeedback,
}: {
  items: ReputationOverview["replyQueue"];
  onChanged: () => void;
  onFeedback: (f: { type: "success" | "error"; message: string }) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);

  if (items.length === 0) return null;

  const key = (item: { profileId: string; reviewId: string }) => `${item.profileId}:${item.reviewId}`;

  const post = async (item: ReputationOverview["replyQueue"][number]) => {
    const k = key(item);
    const text = (drafts[k] ?? item.draft).trim();
    if (!text) return;
    if (!confirm(`Post this reply publicly on Google for ${item.businessName}?`)) return;
    setBusyKey(k);
    const res = await replyToGbpReview(item.profileId, item.reviewId, text);
    setBusyKey(null);
    if (res.success) {
      onFeedback({ type: "success", message: `Reply posted on Google for ${item.businessName}.` });
      onChanged();
    } else {
      onFeedback({ type: "error", message: res.error ?? "Posting the reply failed." });
    }
  };

  const discard = async (item: ReputationOverview["replyQueue"][number]) => {
    if (!confirm("Discard this draft? The review will stay in “awaiting reply”.")) return;
    const k = key(item);
    setBusyKey(k);
    const res = await discardGbpReply(item.profileId, item.reviewId);
    setBusyKey(null);
    if (res.success) onChanged();
    else onFeedback({ type: "error", message: res.error ?? "Discard failed." });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="size-5 text-primary" /> Reply queue
          <span className="text-xs font-normal text-muted-foreground">({items.length})</span>
        </CardTitle>
        <CardDescription>
          Lana pre-drafted replies for new low-star reviews. Edit if needed, then approve to post publicly on Google.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {items.map((item) => {
          const k = key(item);
          const text = drafts[k] ?? item.draft;
          const stars = QUEUE_STARS[item.starRating] ?? 0;
          const busy = busyKey === k;
          return (
            <div key={k} className="rounded-md border p-3 space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="flex items-center gap-0.5 shrink-0">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <Star key={i} className={`size-3.5 ${i <= stars ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30"}`} />
                    ))}
                  </span>
                  <span className="text-sm font-medium truncate">{item.reviewerName ?? "Google user"}</span>
                  <span className="text-xs text-muted-foreground">on {item.businessName}</span>
                  {item.createTime && <span className="text-xs text-muted-foreground">· {formatReviewDate(item.createTime)}</span>}
                </div>
                <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive shrink-0 size-7" onClick={() => discard(item)} disabled={busy} title="Discard draft">
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
              {item.comment && <p className="text-sm text-muted-foreground whitespace-pre-line">{item.comment}</p>}
              {item.notes.length > 0 && (
                <div className="space-y-1">
                  {item.notes.map((n, i) => (
                    <p key={i} className="text-xs text-muted-foreground border-l-2 border-primary/40 pl-2 whitespace-pre-line">{n}</p>
                  ))}
                </div>
              )}
              <textarea
                className="w-full rounded-md border bg-background p-2 text-sm min-h-20 focus:outline-none focus:ring-1 focus:ring-ring"
                rows={4}
                maxLength={4000}
                value={text}
                onChange={(e) => setDrafts((s) => ({ ...s, [k]: e.target.value }))}
              />
              <div className="flex items-center gap-2">
                <Button size="sm" disabled={busy || !text.trim()} onClick={() => post(item)}>
                  {busy ? <><Loader2 className="size-3.5 animate-spin mr-1.5" /> Posting…</> : <><Send className="size-3.5 mr-1.5" /> Approve & post</>}
                </Button>
                {text !== item.draft && (
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => setDrafts((s) => { const n = { ...s }; delete n[k]; return n; })}>
                    <X className="size-3.5 mr-1" /> Reset edit
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function formatReviewDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short" });
}

// ---------------------------------------------------------------------------
// Sparkline — 12-week average-rating trend, one listing per line.
// ---------------------------------------------------------------------------

const SPARK_W = 120;
const SPARK_H = 30;
const SPARK_PAD = 3;

function Sparkline({ data }: { data: ReputationOverview["listings"][number]["sparkline"] }) {
  const points = data.filter((d) => d.avg != null) as { week: string; avg: number; count: number }[];
  if (points.length === 0) {
    return <span className="text-xs text-muted-foreground">no recent reviews</span>;
  }
  // Fixed 1..5 scale so two listings' sparklines are visually comparable.
  const y = (avg: number) => SPARK_PAD + (1 - (avg - 1) / 4) * (SPARK_H - 2 * SPARK_PAD);
  const step = points.length > 1 ? (SPARK_W - 2 * SPARK_PAD) / (points.length - 1) : 0;
  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${(SPARK_PAD + i * step).toFixed(1)},${y(p.avg).toFixed(1)}`)
    .join(" ");
  const first = points[0].avg;
  const last = points[points.length - 1].avg;
  const trend = last > first ? "text-green-600" : last < first ? "text-red-500" : "text-muted-foreground";
  const delta = Math.round((last - first) * 10) / 10;
  const title = `Weekly avg rating, last 12 weeks (${points[0].week} → ${points[points.length - 1].week}): ${points
    .map((p) => `${p.week} ${p.avg}★ (${p.count})`)
    .join(", ")}`;
  return (
    <span className="inline-flex items-center gap-2" title={title}>
      <svg width={SPARK_W} height={SPARK_H} className="overflow-visible">
        {/* 3★ reference line */}
        <line x1={SPARK_PAD} x2={SPARK_W - SPARK_PAD} y1={y(3)} y2={y(3)} stroke="currentColor" className="text-muted-foreground/30" strokeDasharray="3 3" strokeWidth="1" />
        <path d={path} fill="none" strokeWidth="1.5" className="stroke-primary" />
        <circle cx={SPARK_PAD + (points.length - 1) * step} cy={y(last)} r="2.2" className="fill-primary" />
      </svg>
      <span className={`text-xs font-medium ${trend}`}>
        {delta > 0 ? "+" : ""}{delta || "±0"}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Digest notes — client feedback that arrived by replying to the weekly email.
// ---------------------------------------------------------------------------

function DigestNotesCard({
  items,
}: {
  items: ReputationOverview["digestNotes"];
}) {
  const [open, setOpen] = useState(true);
  if (items.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <button className="flex items-center justify-between w-full text-left" onClick={() => setOpen((o) => !o)}>
          <span className="flex items-center gap-2">
            <Mail className="size-5 text-primary" />
            <CardTitle className="text-base">Digest reply notes</CardTitle>
            <span className="text-xs font-normal text-muted-foreground">({items.length})</span>
          </span>
          <span className="text-xs text-muted-foreground">{open ? "Hide" : "Show"}</span>
        </button>
        <CardDescription>
          Feedback from replies to the weekly digest email, attached to the review each note was about.
        </CardDescription>
      </CardHeader>
      {open && (
        <CardContent className="space-y-3">
          {items.map((item) => (
            <div key={item.reviewId} className="rounded-md border p-3 space-y-1.5">
              <p className="text-sm font-medium">
                {item.reviewerName ?? "Google user"} <span className="text-xs text-muted-foreground font-normal">on {item.businessName}</span>
              </p>
              {item.notes.map((n, i) => (
                <p key={i} className="text-sm text-muted-foreground border-l-2 border-primary/40 pl-3 whitespace-pre-line">{n}</p>
              ))}
            </div>
          ))}
        </CardContent>
      )}
    </Card>
  );
}
