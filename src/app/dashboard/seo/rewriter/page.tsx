"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Loader2,
  RefreshCw,
  Sparkles,
  TrendingUp,
  CheckCircle2,
  XCircle,
  ExternalLink,
  Save,
  Wand2,
} from "lucide-react";
import { ScoreBreakdown } from "@/components/seo/score-breakdown";
import { RewriteComparisonTable } from "@/components/seo/rewrite-comparison";
import PublishButton from "@/components/PublishButton";

/**
 * Minimal, dependency-free markdown → HTML for the formatted view. Escapes
 * HTML first, then applies the subset the rewriter emits (headings, bold,
 * italics, lists, images, links, blockquotes, paragraphs).
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inlineMd(s: string): string {
  return s
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/\*([^*\n]+)\*/g, "<em>$1</em>")
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/!\[([^\]]*)\]\(([^)\s]+)(\s+"[^"]*")?\)/g, '<img src="$2" alt="$1" loading="lazy" />')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
}

function renderMarkdown(md: string): string {
  const escaped = escapeHtml(md);
  const lines = escaped.split(/\r?\n/);
  const out: string[] = [];
  let list: { tag: string; items: string[] } | null = null;

  const closeList = () => {
    if (list) {
      out.push(`<${list.tag}>${list.items.map((i) => `<li>${i}</li>`).join("")}</${list.tag}>`);
      list = null;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      closeList();
      const level = h[1].length;
      out.push(`<h${level}>${inlineMd(h[2])}</h${level}>`);
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const tag = ordered ? "ol" : "ul";
      const item = line.replace(/^\s*(?:[-*+]|\d+\.)\s+/, "");
      if (!list || list.tag !== tag) {
        closeList();
        list = { tag, items: [] };
      }
      list.items.push(inlineMd(item));
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      closeList();
      out.push(`<blockquote>${inlineMd(line.replace(/^\s*>\s?/, ""))}</blockquote>`);
      continue;
    }
    if (/^\s*---\s*$/.test(line) || /^\s*\*\*\*\s*$/.test(line)) {
      closeList();
      out.push("<hr />");
      continue;
    }
    if (/^\s*$/.test(line)) {
      closeList();
      continue;
    }
    closeList();
    out.push(`<p>${inlineMd(line)}</p>`);
  }
  closeList();
  return out.join("\n");
}

interface Check {
  id: string;
  label: string;
  category?: string;
  pillar?: string;
  maxPoints: number;
  earned: number;
  passed: boolean;
  detail: string;
}

interface RewriteResponse {
  success: boolean;
  saved: boolean;
  savedPostId?: string | null;
  postsUrl?: string;
  dashboardUrl: string;
  rewrittenBody: string;
  originalScores: { seo: number | null; aeoGeo: number | null; passed: boolean };
  finalScores: { seo: number | null; aeoGeo: number | null; passed: boolean };
  attempts: {
    attempt: number;
    passed: boolean;
    feedback: string;
    seo: { total: number; checks: Check[] } | null;
    aeoGeo: { total: number; checks: Check[] } | null;
  }[];
  gate: number;
  passed: boolean;
  rewritten: boolean;
  keyword: string;
  title: string;
  rewriteError?: string;
  finalBody?: string;
  original: { seo: { total: number; checks: Check[] } | null; aeoGeo: { total: number; aeoScore: number; geoSscore: number; checks: Check[] } | null };
  final: { seo: { total: number; checks: Check[] } | null; aeoGeo: { total: number; aeoScore: number; geoSscore: number; checks: Check[] } | null };
}

function scoreTone(v: number | null | undefined): string {
  if (v == null) return "text-muted-foreground";
  return v >= 80 ? "text-green-600 dark:text-green-400" : v >= 50 ? "text-yellow-600 dark:text-yellow-400" : "text-red-600 dark:text-red-400";
}

export default function SeoRewriterPage() {
  const searchParams = useSearchParams();
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [keyword, setKeyword] = useState("");
  const [editInstructions, setEditInstructions] = useState("");
  const [loading, setLoading] = useState(false);
  const [refining, setRefining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RewriteResponse | null>(null);
  const [viewMode, setViewMode] = useState<"markdown" | "formatted">("formatted");
  const [copied, setCopied] = useState(false);

  // Prefill from "Edit & re-compare" links on the Monitored Sites dashboard.
  useEffect(() => {
    const t = searchParams.get("text");
    const ti = searchParams.get("title");
    const k = searchParams.get("keyword");
    if (t) setText(t);
    if (ti) setTitle(ti);
    if (k) setKeyword(k);
  }, [searchParams]);

  const run = async (overrides?: {
    text?: string;
    title?: string;
    keyword?: string;
    instructions?: string;
    targeted?: boolean;
  }) => {
    const body = overrides?.text ?? text;
    if (!body.trim()) {
      setError("Paste a piece of text content to rewrite.");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/seo/rewrite", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: body,
          title: overrides?.title ?? (title || undefined),
          keyword: overrides?.keyword ?? (keyword || undefined),
          instructions: overrides?.instructions || undefined,
          targeted: overrides?.targeted,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Rewrite failed.");
        return;
      }
      setResult(data);
      // Keep the form in sync with the version just produced.
      setText(data.rewrittenBody ?? data.finalBody ?? body);
      if (data.title) setTitle(data.title);
      if (data.keyword) setKeyword(data.keyword);
    } catch {
      setError("Network error while rewriting.");
    } finally {
      setLoading(false);
    }
  };

  // One-click targeted fix: keep the winning rewrite, fix only remaining fails.
  const refine = async () => {
    if (!result?.rewrittenBody) return;
    setRefining(true);
    await run({
      text: result.rewrittenBody,
      title: result.title,
      keyword: result.keyword,
      instructions: editInstructions,
      targeted: true,
    });
    setRefining(false);
    setEditInstructions("");
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Content Rewriter</h1>
        <p className="text-muted-foreground mt-1">
          Paste any piece of text — a draft, a competitor&apos;s page, an old
          article — and it gets rewritten to clear the SEO / AEO / GEO quality
          gate (80/80). Passing results are saved to your Monitored Sites
          dashboard.
        </p>
      </div>

      <Card className="p-5">
        <div className="grid sm:grid-cols-2 gap-4 mb-4">
          <div className="space-y-1.5">
            <Label htmlFor="rw-title">Title (optional)</Label>
            <Input
              id="rw-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="The page title the content should satisfy"
              disabled={loading}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rw-keyword">Focus keyword (optional)</Label>
            <Input
              id="rw-keyword"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="e.g. seasonal coffee menu"
              disabled={loading}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rw-text">Content to rewrite</Label>
          <textarea
            id="rw-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={12}
            disabled={loading}
            placeholder="Paste the text here…"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
          />
        </div>
        <div className="mt-4 flex items-center gap-3">
          <Button onClick={() => run()} disabled={loading || !text.trim()}>
            {loading ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Rewriting…
              </>
            ) : (
              <>
                <RefreshCw className="size-4" /> Rewrite to pass the gate
              </>
            )}
          </Button>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      </Card>

      {result && (
        <>
          {/* Score comparison */}
          <Card className="p-5">
            {result.rewriteError && (
              <div className="mb-4 p-3 rounded-md bg-destructive/10 border border-destructive/30 text-sm text-destructive">
                The AI rewrite call failed — the original content was returned unchanged:
                {result.rewriteError}
              </div>
            )}
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="size-4 text-primary" />
              <h2 className="text-lg font-semibold">Before → After</h2>
              <span className={`text-xs px-2 py-0.5 rounded-full ${result.passed ? "bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300" : "bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300"}`}>
                {result.passed ? "Passes the gate" : "Below gate (best attempt kept)"}
              </span>
              {result.saved && (
                <a href={result.dashboardUrl} className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline">
                  <Save className="size-3.5" /> Saved to Monitored Sites <ExternalLink className="size-3" />
                </a>
              )}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: "SEO", before: result.originalScores.seo, after: result.finalScores.seo },
                { label: "AEO", before: result.original?.aeoGeo?.aeoScore ?? result.originalScores.aeoGeo, after: result.final?.aeoGeo?.aeoScore ?? result.finalScores.aeoGeo },
                { label: "GEO", before: result.original?.aeoGeo?.geoSscore ?? result.originalScores.aeoGeo, after: result.final?.aeoGeo?.geoSscore ?? result.finalScores.aeoGeo },
                { label: "Gate", before: result.gate, after: result.gate },
              ].map((s) => (
                <div key={s.label} className="p-3 rounded-lg bg-muted/50 text-center">
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{s.label}</div>
                  <div className="text-xl font-bold mt-0.5 flex items-center justify-center gap-2">
                    <span className={scoreTone(s.before)}>{s.before ?? "—"}</span>
                    <span className="text-muted-foreground text-sm">→</span>
                    <span className={scoreTone(s.after)}>{s.after ?? "—"}</span>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Detected keyword: <span className="font-medium">“{result.keyword || "—"}”</span>
            </p>
            {result.rewritten && (
              <p className="text-xs text-green-600 dark:text-green-400 mt-3">
                ✦ The content was rewritten and now passes the gate (SEO{" "}
                {result.finalScores.seo} / AEO-GEO {result.finalScores.aeoGeo}, gate {result.gate}).
              </p>
            )}
            {!result.rewritten && result.passed && (
              <p className="text-xs text-muted-foreground mt-3">
                The original already passed the gate — the rewrite kept the structure with light polish.
              </p>
            )}
          </Card>

          {/* Side-by-side factor comparison */}
          <Card className="p-5">
            <RewriteComparisonTable
              beforeSeo={result.original?.seo?.checks ?? []}
              beforeAeoGeo={result.original?.aeoGeo?.checks ?? []}
              afterSeo={result.final?.seo?.checks ?? []}
              afterAeoGeo={result.final?.aeoGeo?.checks ?? []}
              beforeSeoScore={result.originalScores.seo}
              afterSeoScore={result.finalScores.seo}
              beforeAeoScore={result.original?.aeoGeo?.aeoScore ?? null}
              afterAeoScore={result.final?.aeoGeo?.aeoScore ?? null}
              beforeGeoScore={result.original?.aeoGeo?.geoSscore ?? null}
              afterGeoScore={result.final?.aeoGeo?.geoSscore ?? null}
            />
          </Card>

          {/* Attempts */}
          {result.attempts.length > 1 && (
            <Card className="p-5">
              <h2 className="text-lg font-semibold mb-3">Rewrite attempts</h2>
              <div className="space-y-2">
                {result.attempts.map((a, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm rounded-md border p-2.5">
                    {a.passed ? (
                      <CheckCircle2 className="size-4 text-green-600 dark:text-green-400 shrink-0" />
                    ) : (
                      <XCircle className="size-4 text-red-500 shrink-0" />
                    )}
                    <span className="font-medium">Attempt {a.attempt}</span>
                    <span className="text-muted-foreground text-xs">
                      SEO {a.seo?.total ?? "—"} / AEO-GEO {a.aeoGeo?.total ?? "—"}
                    </span>
                    {a.feedback && (
                      <span className="text-[11px] text-muted-foreground ml-auto truncate max-w-[40%]">
                        {a.feedback.split("\n").find((l) => l.startsWith("- "))?.slice(2) ?? "failed checks fed to model"}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Rewritten body */}
          <Card className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Sparkles className="size-4 text-primary" /> Rewritten content
              </h2>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-1 rounded-lg border border-border p-0.5">
                  <button
                    onClick={() => setViewMode("formatted")}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${viewMode === "formatted" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    Formatted
                  </button>
                  <button
                    onClick={() => setViewMode("markdown")}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${viewMode === "markdown" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    Markdown
                  </button>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    const payload =
                      viewMode === "formatted"
                        ? renderMarkdown(result.rewrittenBody)
                        : result.rewrittenBody;
                    await navigator.clipboard.writeText(payload);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                >
                  {copied ? "Copied!" : viewMode === "formatted" ? "Copy formatted (HTML)" : "Copy markdown"}
                </Button>
                {result.savedPostId && (
                  <PublishButton postId={result.savedPostId} postType="blog" />
                )}
              </div>
            </div>
            {viewMode === "formatted" ? (
              <div
                className="prose prose-sm dark:prose-invert max-w-none bg-muted/50 rounded-md p-4 max-h-96 overflow-y-auto [&_img]:max-w-full [&_img]:rounded-md [&_h1]:text-xl [&_h2]:text-lg [&_h3]:text-base [&_li]:my-0.5"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(result.rewrittenBody) }}
              />
            ) : (
              <pre className="whitespace-pre-wrap text-sm font-mono bg-muted/50 rounded-md p-4 max-h-96 overflow-y-auto">
                {result.rewrittenBody}
              </pre>
            )}
            {result.savedPostId && (
              <p className="text-xs text-green-600 dark:text-green-400 mt-3">
                ✦ Saved to Recent Content as a draft — publish it from here or{" "}
                <a href={result.postsUrl} className="underline">open it in Posts</a>.
              </p>
            )}
          </Card>

          {/* Targeted re-edit: keep the winner, fix only remaining fails */}
          <Card className="p-5">
            <div className="flex items-center gap-2 mb-2">
              <Wand2 className="size-4 text-primary" />
              <h2 className="text-lg font-semibold">Rewrite with these edits</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-3">
              Keeps the winning rewrite and applies targeted fixes for just the
              remaining failing checks, plus whatever edits you describe.
            </p>
            <textarea
              value={editInstructions}
              onChange={(e) => setEditInstructions(e.target.value)}
              rows={2}
              placeholder="e.g. Make the intro shorter, add a pricing section, use a friendlier tone…"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm mb-3"
            />
            <Button onClick={refine} disabled={refining || loading}>
              {refining ? (
                <>
                  <Loader2 className="size-4 animate-spin mr-2" /> Refining…
                </>
              ) : (
                <>
                  <Wand2 className="size-4 mr-2" /> Rewrite with these edits
                </>
              )}
            </Button>
          </Card>

          {/* Per-check breakdown of the final version */}
          <Card className="p-5">
            <h2 className="text-lg font-semibold mb-3">How the final score is made</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <ScoreBreakdown
                title="SEO"
                score={result.final?.seo?.total ?? null}
                seoChecks={result.final?.seo?.checks ?? []}
                defaultCollapsed={false}
              />
              <ScoreBreakdown
                title="AEO"
                score={result.finalScores.aeoGeo}
                aeoGeoChecks={(result.final?.aeoGeo?.checks ?? []).filter((c) => c.pillar === "AEO")}
              />
              <ScoreBreakdown
                title="GEO"
                score={result.finalScores.aeoGeo}
                aeoGeoChecks={(result.final?.aeoGeo?.checks ?? []).filter((c) => c.pillar === "GEO")}
              />
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
