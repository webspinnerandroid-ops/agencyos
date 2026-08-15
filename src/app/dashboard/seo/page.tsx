"use client";

import { useState, useTransition, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Loader2, Search, BarChart3, Globe, Target, Zap } from "lucide-react";

export default function SeoPage() {
  const [url, setUrl] = useState("");
  const [feedback, setFeedback] = useState<{ type: string; message: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleGenerate = () => {
    if (!url.trim()) return;
    // Redirect to the generate-campaign API
    window.location.href = `/dashboard/seo/campaigns`;
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">SEO Audits</h1>
        <p className="text-muted-foreground mt-1">Run website audits, generate tiered SEO proposals, discover competitors, and share with clients.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Search className="size-4 text-primary" />Site Audit</CardTitle><CardDescription>Crawl a website and identify technical and on-page SEO issues.</CardDescription></CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Input placeholder="https://example.com" value={url} onChange={e => setUrl(e.target.value)} />
              <Button className="w-full" onClick={handleGenerate}>Run Audit</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Target className="size-4 text-primary" />Audits</CardTitle><CardDescription>View and manage generated SEO audits and proposals.</CardDescription></CardHeader>
          <CardContent>
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Access your generated SEO audits with customized, tiered proposals for each client.</p>
              <Button className="w-full" variant="outline" onClick={() => window.location.href = "/dashboard/seo/campaigns"}>View Audits</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Search className="size-4 text-primary" />Content Analyzer</CardTitle><CardDescription>Paste a URL or text and run the SEO / AEO / GEO test suite on it.</CardDescription></CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">See the full per-check score breakdown and whether the content clears the 80/80 gate.</p>
            <Button className="w-full" variant="outline" onClick={() => window.location.href = "/dashboard/seo/analyzer"}>Open Analyzer</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><BarChart3 className="size-4 text-primary" />Rankings</CardTitle><CardDescription>Track keyword rankings over time.</CardDescription></CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Coming soon — connect Google Search Console to track keyword performance.</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Zap className="size-4 text-primary" />Quick Audit</CardTitle><CardDescription>Enter a client website URL to run a full SEO audit and generate customized proposals.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <Input placeholder="https://client-site.com" value={url} onChange={e => setUrl(e.target.value)} className="flex-1" />
            <Button onClick={handleGenerate} disabled={isPending}>
              {isPending ? <Loader2 className="size-4 animate-spin mr-2" /> : <Zap className="size-4 mr-2" />}
              Run Audit
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}