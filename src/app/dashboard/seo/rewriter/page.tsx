"use client";

import { useState } from "react";
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
} from "lucide-react";
import { ScoreBreakdown } from "@/components/seo/score-breakdown";

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
  original: { seo: { total: number; checks: Check[] } | null; aeoGeo: { total: number; aeoScore: number; geoSscore: number; checks: Check[] } | null };
  final: { seo: { total: number; checks: Check[] } | null; aeoGeo: { total: number; aeoScore: number; geoSscore: number; checks: Check[] } | null };
}

function scoreTone(v: number | null | undefined): string {
  if (v == null) return "text-muted-foreground";
  return v >= 80 ? "text-green-600 dark:text-green-400" : v >= 50 ? "text-yellow-600 dark:text-yellow-400" : "text-red-600 dark:text-red-400";
}

export default function SeoRewriterPage() {
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RewriteResponse | null>(null);

  const run = async () => {
    if (!text.trim()) {
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
        body: JSON.stringify({ text, title: title || undefined, keyword: keyword || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Rewrite failed.");
        return;
      }
      setResult(data);
    } catch {
      setError("Network error while rewriting.");
    } finally {
      setLoading(false);
    }
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
          <Button onClick={run} disabled={loading || !text.trim()}>
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
            <div className="flex items-center justify-between gap-2 mb-3">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Sparkles className="size-4 text-primary" /> Rewritten content
              </h2>
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigator.clipboard.writeText(result.rewrittenBody)}
              >
                Copy
              </Button>
            </div>
            <pre className="whitespace-pre-wrap text-sm font-mono bg-muted/50 rounded-md p-4 max-h-96 overflow-y-auto">
              {result.rewrittenBody}
            </pre>
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
