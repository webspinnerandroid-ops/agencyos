"use client";

import { useEffect, useState } from "react";
import { X, ImageIcon, Sparkles, RefreshCw, Loader2 } from "lucide-react";
import PublishButton from "@/components/PublishButton";
import PostContent from "@/components/BlogContent";
import ScoreBadge from "@/components/ScoreBadge";
import {
  getPostPreview,
  getSeoScore,
  parseContent,
  statusBadgeClass,
  type PostRow,
} from "@/lib/post-preview";

/**
 * Modal showing a full post. The list only ships lightweight fields (title /
 * type / platform) — opening the modal fetches the complete post (including
 * the possibly megabytes-large body with embedded images) on demand.
 */
export default function PostDetailModal({
  post,
  onClose,
  onDeleted,
}: {
  post: PostRow;
  onClose: () => void;
  onDeleted: (id: string) => void;
}) {
  const [full, setFull] = useState<PostRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  // Rewrite with AI — the "why" guides Cheryl's regeneration.
  const [rewriteOpen, setRewriteOpen] = useState(false);
  const [rewriteFeedback, setRewriteFeedback] = useState("");
  const [rewriting, setRewriting] = useState(false);
  const [rewriteMessage, setRewriteMessage] = useState<string | null>(null);
  // AEO/GEO panel state
  const [aeoGeo, setAeoGeo] = useState<{
    result: any;
    source: "heuristic" | "llm";
  } | null>(null);
  const [aeoLoading, setAeoLoading] = useState(false);
  const [aeoError, setAeoError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/posts/${post.id}`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.post) setFull(data.post as PostRow);
      })
      .catch(() => {
        // Fall back to the list preview — never block the modal on this.
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [post.id]);

  const current = full ?? post;
  const preview = getPostPreview(current);
  const c = parseContent(current.content) ?? {};
  const seo = c.seo as
    | {
        score?: number;
        keyword?: string;
        checks?: {
          id: string;
          label: string;
          category: string;
          maxPoints: number;
          earned: number;
          passed: boolean;
          detail: string;
        }[];
      }
    | undefined;
  const seoChecks = seo?.checks?.length ? seo.checks : (current.seo_checks as any[] | null) ?? [];
  const images: { url: string; description?: string; placement?: string }[] =
    (c.images as never[] | undefined) ?? [];

  // Runs the AEO/GEO scorer for blog posts. Heuristic by default; the AI
  // Deep Check button opts into the LLM-assisted pass (falls back cleanly).
  const runAeoGeo = async (deep: boolean) => {
    if (!post.id) return;
    setAeoLoading(true);
    setAeoError(null);
    try {
      const res = await fetch(`/api/posts/${post.id}/aeo-geo`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deep }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAeoError(data.error ?? "AEO/GEO check failed");
        return;
      }
      setAeoGeo({ result: data.result, source: data.source });
    } catch (err: any) {
      setAeoError(err.message ?? "AEO/GEO check failed");
    } finally {
      setAeoLoading(false);
    }
  };

  // Auto-run the free heuristic check when a blog post opens.
  useEffect(() => {
    if (preview.type === "blog" && !aeoGeo && !aeoLoading && !aeoError) {
      runAeoGeo(false);
    }
  }, [preview.type]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRewrite = async () => {
    if (!post.id || !rewriteFeedback.trim() || rewriting) return;
    setRewriting(true);
    setRewriteMessage(null);
    try {
      const res = await fetch(`/api/posts/${post.id}/regenerate`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedback: rewriteFeedback.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRewriteMessage(data?.error ?? "Rewrite failed — please try again.");
        return;
      }
      setRewriteOpen(false);
      setRewriteFeedback("");
      setRewriteMessage("Rewritten — reloading the updated post…");
      // Re-fetch the full post so the modal shows the new content + score.
      try {
        const r = await fetch(`/api/posts/${post.id}`, { credentials: "include" });
        const d = await r.json().catch(() => ({}));
        if (d?.post) setFull(d.post as PostRow);
      } catch {
        // keep the stale copy — the next open will be fresh
      }
      setAeoGeo(null);
      setAeoError(null);
    } catch {
      setRewriteMessage("Network error — please try again.");
    } finally {
      setRewriting(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("Delete this post? This cannot be undone.")) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/posts/${post.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) {
        onDeleted(post.id);
        onClose();
      } else {
        alert("Failed to delete post. Please try again.");
      }
    } catch {
      alert("Network error. Please try again.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-card border rounded-lg w-full max-w-2xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="font-semibold tracking-tight">{preview.title}</h3>
          {loading && (
            <span className="text-xs text-muted-foreground animate-pulse">
              Loading full post…
            </span>
          )}
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-muted text-muted-foreground"
            title="Close"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="p-4 space-y-4 overflow-y-auto">
          {/* Meta */}
          <div className="flex flex-wrap gap-2 text-xs">
            <span
              className={`px-2 py-0.5 rounded-full capitalize ${statusBadgeClass(current.status)}`}
            >
              {current.status}
            </span>
            {preview.type && (
              <span className="px-2 py-0.5 rounded-full bg-muted text-muted-foreground capitalize">
                {preview.type}
              </span>
            )}
            {current.ai_generated && (
              <span className="px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300">
                AI Generated
              </span>
            )}
            {preview.type === "blog" && (
              <ScoreBadge score={getSeoScore(current)} />
            )}
            {current.tier_level != null && (
              <span className="px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                Tier {current.tier_level}
              </span>
            )}
          </div>

          {/* Scheduled */}
          {current.scheduled_at && (
            <div className="text-xs text-muted-foreground">
              Scheduled:{" "}
              {new Date(current.scheduled_at).toLocaleString("en-US", {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </div>
          )}

          {/* Content — blog bodies render as markdown so embedded images display */}
          <div>
            <h4 className="text-sm font-semibold mb-2">Content</h4>
            <div className="text-sm text-muted-foreground bg-muted/50 rounded-md p-3 max-h-80 overflow-y-auto">
              {preview.type === "blog" && preview.body ? (
                <PostContent content={preview.body} markdown />
              ) : (
                <div className="whitespace-pre-wrap">
                  {preview.body || JSON.stringify(current.content, null, 2) || "No content"}
                </div>
              )}
            </div>
          </div>

          {/* On-page SEO checklist (Rank Math-style) */}
          {seoChecks.length > 0 && (
            <details open={seoChecks.some((chk) => !chk.passed)}>
              <summary className="text-sm font-semibold cursor-pointer mb-2">
                On-page SEO — {getSeoScore(current) ?? "—"}/100
                {seo?.keyword ? (
                  <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-muted font-normal">
                    focus keyword: “{seo.keyword}”
                  </span>
                ) : null}
              </summary>
              <ul className="space-y-1.5">
                {seoChecks.map((chk, i) => (
                  <li
                    key={chk.id ?? i}
                    className={`text-xs flex items-start gap-2 ${
                      chk.passed ? "text-muted-foreground" : "text-destructive"
                    }`}
                  >
                    <span>{chk.passed ? "✓" : "✗"}</span>
                    <span>
                      <span className="font-medium">{chk.label}</span>
                      <span className="block text-[11px] opacity-70">{chk.detail}</span>
                    </span>
                    <span className="ml-auto shrink-0">
                      {chk.earned}/{chk.maxPoints}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {/* AEO/GEO readiness (answer engines + AI citation) */}
          {preview.type === "blog" && (
            <div className="border rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h4 className="text-sm font-semibold">AEO / GEO Readiness</h4>
                <button
                  onClick={() => runAeoGeo(true)}
                  disabled={aeoLoading}
                  className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border hover:bg-muted disabled:opacity-50"
                  title="Run the LLM-assisted deep check (costs one AI call)"
                >
                  <Sparkles className="size-3" />
                  {aeoLoading ? "Checking…" : "AI Deep Check"}
                </button>
              </div>
              {aeoError && (
                <p className="text-xs text-destructive">{aeoError}</p>
              )}
              {aeoLoading && !aeoGeo && (
                <p className="text-xs text-muted-foreground animate-pulse">Analyzing structure…</p>
              )}
              {aeoGeo?.result && (
                <>
                  <div className="flex items-center gap-2 text-xs">
                    <span
                      className={`px-2 py-0.5 rounded-full font-semibold ${
                        aeoGeo.result.total >= 81
                          ? "bg-green-100 text-green-700"
                          : aeoGeo.result.total >= 50
                          ? "bg-yellow-100 text-yellow-700"
                          : "bg-red-100 text-red-700"
                      }`}
                    >
                      {aeoGeo.result.total}/100
                    </span>
                    <span className="text-muted-foreground">
                      AEO {aeoGeo.result.aeoScore}/50 · GEO {aeoGeo.result.geoSscore}/50
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {aeoGeo.source === "llm" ? "LLM-assisted" : "AI-estimated readiness, not a guarantee of citation"}
                    </span>
                  </div>
                  <details open={aeoGeo.result.checks?.some((c: any) => !c.passed)}>
                    <summary className="text-xs font-medium cursor-pointer">Checklist</summary>
                    <ul className="space-y-1.5 mt-1.5">
                      {(aeoGeo.result.checks ?? []).map((chk: any, i: number) => (
                        <li
                          key={chk.id ?? i}
                          className={`text-xs flex items-start gap-2 ${
                            chk.passed ? "text-muted-foreground" : "text-destructive"
                          }`}
                        >
                          <span>{chk.passed ? "✓" : "✗"}</span>
                          <span>
                            <span className="font-medium">
                              {chk.pillar === "AEO" ? "A" : "G"} · {chk.label}
                            </span>
                            <span className="block text-[11px] opacity-70">{chk.detail}</span>
                          </span>
                          <span className="ml-auto shrink-0">
                            {chk.earned}/{chk.maxPoints}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </details>
                  {aeoGeo.result.qaPairs?.length > 0 && (
                    <details>
                      <summary className="text-xs font-medium cursor-pointer">
                        Answer-library pairs ({aeoGeo.result.qaPairs.length})
                      </summary>
                      <ul className="mt-1.5 space-y-1.5">
                        {aeoGeo.result.qaPairs.map((p: any, i: number) => (
                          <li key={i} className="text-xs">
                            <span className="font-medium">Q: {p.q}</span>
                            <span className="block text-muted-foreground text-[11px]">
                              A: {p.a}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </>
              )}
            </div>
          )}

          {/* Raw JSON toggle for debugging/advanced */}
          <details>
            <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
              View raw data
            </summary>
            <pre className="mt-2 text-[10px] bg-muted/40 rounded p-3 overflow-x-auto max-h-48">
              {JSON.stringify(current.content, null, 2)}
            </pre>
          </details>

          {/* Generated images + suggested image prompt */}
          {images.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                <ImageIcon className="size-3.5" /> Generated Images ({images.length})
              </h4>
              <div className="grid gap-2 sm:grid-cols-2">
                {images.map((img, i) => (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    key={i}
                    src={img.url}
                    alt={img.description || "Generated image"}
                    className="w-full h-28 object-cover rounded-md border"
                  />
                ))}
              </div>
            </div>
          )}
          {preview.suggestedImagePrompt && (
            <div>
              <h4 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                <ImageIcon className="size-3.5" /> Suggested Image Prompt
              </h4>
              <p className="text-sm text-muted-foreground bg-purple-50 dark:bg-purple-950/50 rounded-md p-3 italic">
                {preview.suggestedImagePrompt}
              </p>
            </div>
          )}
        </div>
        <div className="p-4 border-t flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground min-w-0">{rewriteMessage ?? ""}</span>
          <div className="flex justify-end gap-2 shrink-0">
            {preview.type === "blog" && (
              <button
                onClick={() => {
                  setRewriteFeedback("");
                  setRewriteMessage(null);
                  setRewriteOpen(true);
                }}
                disabled={rewriting}
                className="px-3 py-1.5 text-sm rounded-md border border-primary/30 text-primary hover:bg-primary/10 transition-colors inline-flex items-center gap-1.5"
                title="Ask Cheryl to rewrite this post to match your preferred style"
              >
                <RefreshCw className="size-3.5" /> Rewrite
              </button>
            )}
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="px-3 py-1.5 text-sm rounded-md border border-red-200 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
            >
              {deleting ? "Deleting…" : "Delete"}
            </button>
            <PublishButton postId={current.id} postType={preview.type as "blog" | "social"} />
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-sm border rounded-md hover:bg-muted"
            >
              Close
            </button>
          </div>
        </div>
      </div>

      {/* Rewrite with AI — ask WHY so the rewrite is guided to the preferred style */}
      {rewriteOpen && (
        <div
          className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4"
          onClick={() => !rewriting && setRewriteOpen(false)}
        >
          <div
            className="bg-card border rounded-lg w-full max-w-md p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h3 className="font-semibold tracking-tight flex items-center gap-2">
                <RefreshCw className="size-4 text-primary" /> Rewrite with AI
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                Describe what you want changed and Cheryl will regenerate the
                post to match.
              </p>
            </div>
            <textarea
              autoFocus
              value={rewriteFeedback}
              onChange={(e) => setRewriteFeedback(e.target.value)}
              rows={5}
              placeholder="e.g. Make the tone more casual and conversational, lead with the 2026 stats, shorten the intro, and end with a stronger call to action."
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={handleRewrite}
                disabled={!rewriteFeedback.trim() || rewriting}
                className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors inline-flex items-center gap-1.5"
              >
                {rewriting ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="size-3.5" />
                )}
                {rewriting ? "Rewriting…" : "Rewrite"}
              </button>
              <button
                onClick={() => setRewriteOpen(false)}
                disabled={rewriting}
                className="px-3 py-1.5 text-sm border rounded-md hover:bg-muted"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
