"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Loader2, Link2, FileText, Search, Wand2 } from "lucide-react";
import { ScoreBreakdown } from "@/components/seo/score-breakdown";

interface EngineCheck {
  id: string;
  label: string;
  category?: string;
  pillar?: string;
  maxPoints: number;
  earned: number;
  passed: boolean;
  detail: string;
}

interface AnalyzeResponse {
  mode: "url" | "text";
  url?: string;
  title: string;
  keyword: string;
  wordCount: number;
  fetched?: boolean;
  fetchError?: string;
  seo: { total: number; checks: EngineCheck[] } | null;
  aeoGeo: { aeoScore: number; geoSscore: number; checks: EngineCheck[] } | null;
  scoreGate: {
    seo: number | null;
    aeo: number | null;
    geo: number | null;
    passesSeoGate: boolean;
    passesAeoGeoGate: boolean;
  };
}

function gateColor(pass: boolean, v: number | null): string {
  if (v == null) return "text-muted-foreground";
  return pass ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400";
}

export default function SeoAnalyzerPage() {
  const [mode, setMode] = useState<"url" | "text">("url");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);

  const runAnalysis = async () => {
    setError(null);
    setResult(null);
    setSavedId(null);
    if (mode === "url" && !url.trim()) {
      setError("Enter a URL to analyze.");
      return;
    }
    if (mode === "text" && !text.trim()) {
      setError("Paste some text content to analyze.");
      return;
    }
    setLoading(true);
    try {
      // Saved to site_audits automatically — shows on the Monitored Sites
      // dashboard with score history + re-audit.
      const res = await fetch("/api/seo/audits", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "url"
            ? { url: url.trim(), keyword: keyword.trim() || undefined }
            : {
                text: text,
                title: title.trim() || undefined,
                keyword: keyword.trim() || undefined,
              }
        ),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Analysis failed.");
        return;
      }
      setResult(data.result ?? data);
      if (data.audit?.id) setSavedId(data.audit.id);
    } catch {
      setError("Network error while analyzing.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Content Analyzer</h1>
        <p className="text-muted-foreground mt-1">
          Paste a URL or a piece of content and run the full SEO / AEO / GEO
          test suite on it — see the score and exactly which checks passed or
          failed, and whether it clears the 80/80 publish gate.
        </p>
      </div>

      <Card className="p-6">
        <Tabs value={mode} onValueChange={(v) => setMode(v as "url" | "text")}>
          <TabsList>
            <TabsTrigger value="url" className="flex items-center gap-1.5">
              <Link2 className="size-4" /> From a URL
            </TabsTrigger>
            <TabsTrigger value="text" className="flex items-center gap-1.5">
              <FileText className="size-4" /> From pasted text
            </TabsTrigger>
          </TabsList>

          <TabsContent value="url" className="mt-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="analyze-url">Website URL</Label>
              <Input
                id="analyze-url"
                placeholder="https://example.com/page"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="analyze-keyword">
                Focus keyword (optional — derived from the domain if blank)
              </Label>
              <Input
                id="analyze-keyword"
                placeholder="e.g., custom software development"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
              />
            </div>
          </TabsContent>

          <TabsContent value="text" className="mt-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="analyze-title">
                Title (optional — used for the SEO title check)
              </Label>
              <Input
                id="analyze-title"
                placeholder="e.g., How Custom Software Development Works"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="analyze-keyword2">
                Focus keyword (optional)
              </Label>
              <Input
                id="analyze-keyword2"
                placeholder="e.g., custom software development"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="analyze-text">Content</Label>
              <textarea
                id="analyze-text"
                placeholder={"Paste your content here (plain text or markdown)…"}
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={10}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring font-mono"
              />
            </div>
          </TabsContent>
        </Tabs>

        {error && (
          <div className="mt-4 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
            {error}
          </div>
        )}

        <Button onClick={runAnalysis} disabled={loading} className="mt-4">
          {loading ? (
            <>
              <Loader2 className="size-4 animate-spin mr-2" />
              Analyzing…
            </>
          ) : (
            <>
              <Search className="size-4 mr-2" />
              Run SEO / AEO / GEO Analysis
            </>
          )}
        </Button>
      </Card>

      {savedId && (
        <div className="p-4 rounded-md bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 text-sm flex items-center justify-between gap-3 flex-wrap">
          <span className="text-green-700 dark:text-green-300">
            ✓ Audit saved — it now appears on your Monitored Sites dashboard with
            score history, so you can re-run it after edits and compare.
          </span>
          <a href="/dashboard/seo/sites" className="text-primary underline hover:underline shrink-0">
            View Monitored Sites →
          </a>
        </div>
      )}

      {result && (
        <div className="space-y-6">
          {/* Result header */}
          <Card className="p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold truncate">
                  {result.title || result.url || "Analysis result"}
                </h2>
                <p className="text-sm text-muted-foreground mt-0.5">
                  scored vs{" "}
                  <span className="font-medium text-foreground">
                    “{result.keyword}”
                  </span>
                  {" · "}
                  {result.wordCount.toLocaleString()} words
                  {result.mode === "url" && result.fetched
                    ? ` · crawled ${result.url}`
                    : ""}
                </p>
              </div>
              {result.scoreGate.seo != null && (
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-muted-foreground">80/80 gate:</span>
                  <span className={gateColor(result.scoreGate.passesSeoGate, result.scoreGate.seo)}>
                    SEO {result.scoreGate.seo}/100
                  </span>
                  <span className={gateColor(result.scoreGate.passesAeoGeoGate, result.scoreGate.aeo)}>
                    AEO {result.scoreGate.aeo}/100
                  </span>
                  <span className={gateColor(result.scoreGate.passesAeoGeoGate, result.scoreGate.geo)}>
                    GEO {result.scoreGate.geo}/100
                  </span>
                </div>
              )}
            </div>
            {result.fetchError && (
              <p className="mt-3 text-sm text-amber-600 dark:text-amber-500">
                {result.fetchError}
              </p>
            )}
          </Card>

          {/* Score breakdowns */}
          <Card className="p-6">
            <div className="flex items-center justify-between gap-2 mb-4">
              <div>
                <h2 className="text-lg font-semibold">How the score is made</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Every check behind the score — earned / max points per test.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <ScoreBreakdown
                title="SEO"
                score={result.seo?.total ?? null}
                seoChecks={result.seo?.checks ?? []}
                defaultCollapsed={false}
              />
              <ScoreBreakdown
                title="AEO"
                score={result.aeoGeo?.aeoScore ?? null}
                aeoGeoChecks={result.aeoGeo?.checks ?? []}
              />
              <ScoreBreakdown
                title="GEO"
                score={result.aeoGeo?.geoSscore ?? null}
                aeoGeoChecks={result.aeoGeo?.checks ?? []}
              />
            </div>
          </Card>

          {/* Fix list */}
          {(result.seo?.checks ?? []).concat(result.aeoGeo?.checks ?? []).some(
            (c) => !c.passed
          ) && (
            <Card className="p-6 border-amber-300 dark:border-amber-800">
              <h2 className="text-lg font-semibold mb-1 flex items-center gap-2">
                <Wand2 className="size-4 text-amber-500" /> What to fix
              </h2>
              <p className="text-xs text-muted-foreground mb-4">
                Every failed check, with the exact reason and what to change.
              </p>
              <ul className="space-y-2">
                {[...(result.seo?.checks ?? []), ...(result.aeoGeo?.checks ?? [])]
                  .filter((c) => !c.passed)
                  .map((c, i) => (
                    <li key={i} className="text-sm flex items-start gap-2">
                      <span className="text-red-500 mt-0.5 shrink-0">✗</span>
                      <span>
                        <span className="font-medium">{c.label}</span>{" "}
                        <span className="text-muted-foreground">
                          — {c.detail}
                        </span>
                      </span>
                    </li>
                  ))}
              </ul>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
