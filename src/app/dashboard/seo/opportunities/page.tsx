"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Loader2, CalendarClock, ExternalLink, Trash2 } from "lucide-react";

interface Opportunity {
  id: string;
  platform: "reddit" | "linkedin" | "quora";
  title: string;
  url: string | null;
  snippet: string | null;
  relevance_score: number;
  recommendation: string | null;
  status: string;
  week_start: string;
  created_at: string;
}

const PLATFORM_COLORS: Record<string, string> = {
  reddit: "bg-orange-100 text-orange-700",
  linkedin: "bg-blue-100 text-blue-700",
  quora: "bg-red-100 text-red-700",
};

const STATUS_COLORS: Record<string, string> = {
  new: "bg-gray-100 text-gray-700",
  drafted: "bg-purple-100 text-purple-700",
  posted: "bg-green-100 text-green-700",
  dismissed: "bg-gray-100 text-gray-500",
};

export default function OpportunitiesPage() {
  const [items, setItems] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [platformFilter, setPlatformFilter] = useState("");
  const [topics, setTopics] = useState("");
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/opportunities${platformFilter ? `?platform=${platformFilter}` : ""}`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setItems(data.opportunities ?? []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [platformFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const runScan = async () => {
    setRunning(true);
    setMessage(null);
    try {
      const res = await fetch("/api/opportunities/generate", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topics: topics.split(",").map((t) => t.trim()).filter(Boolean) }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ type: "error", text: data.error ?? "Scan failed" });
        return;
      }
      setMessage({ type: "success", text: data.message ?? "Scan complete." });
      load();
    } catch (err: any) {
      setMessage({ type: "error", text: err.message ?? "Scan failed" });
    } finally {
      setRunning(false);
    }
  };

  const setStatus = async (id: string, status: string) => {
    const res = await fetch("/api/opportunities", {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    if (res.ok) load();
  };

  const remove = async (id: string) => {
    if (!confirm("Remove this opportunity?")) return;
    await fetch(`/api/opportunities?id=${id}`, { method: "DELETE", credentials: "include" });
    load();
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Weekly Opportunities</h1>
        <p className="text-muted-foreground mt-1">
          Reddit, LinkedIn &amp; Quora spots where the client can post something
          genuinely useful this week — refreshed weekly by the AI team (and on
          demand below). Recommendations are <strong>AI-generated</strong> — review before posting.
        </p>
        <div className="mt-3 rounded-md bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 p-3 text-xs text-amber-800 dark:text-amber-200">
          <strong>Anti-ban rules baked in:</strong> Reddit recommendations are
          helpful comments only — no links or self-promotion (Reddit bans
          blatant promotion and most subreddits require a 9:1 comment-to-promote
          ratio). LinkedIn stays professional, no engagement bait. Quora answers
          are comprehensive and non-promotional. Always read a subreddit&apos;s
          rules and the thread before posting.
        </div>
      </div>

      {message && (
        <div className={`p-3 rounded-md text-sm border ${message.type === "success" ? "bg-green-50 text-green-700 border-green-200" : "bg-red-50 text-red-700 border-red-200"}`}>
          {message.text}
        </div>
      )}

      <Card className="p-5">
        <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <CalendarClock className="size-4 text-primary" /> Run the weekly scan
        </h2>
        <div className="flex gap-2 flex-wrap">
          <Input placeholder="Focus topics (comma separated, optional)" value={topics}
            onChange={(e) => setTopics(e.target.value)} className="flex-1 min-w-[220px]" />
          <Button onClick={runScan} disabled={running}>
            {running ? <Loader2 className="size-4 animate-spin mr-1" /> : <CalendarClock className="size-4 mr-1" />}
            {running ? "Scanning…" : "Scan this week"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Runs automatically every Monday. Each run uses your AI key and adds a fresh week&apos;s batch.
        </p>
      </Card>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => setPlatformFilter("")}
          className={`px-2.5 py-1 rounded-full text-xs border ${!platformFilter ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`}>
          All
        </button>
        {["reddit", "linkedin", "quora"].map((p) => (
          <button key={p} onClick={() => setPlatformFilter(p)}
            className={`px-2.5 py-1 rounded-full text-xs border capitalize ${platformFilter === p ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`}>
            {p}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
      ) : items.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground">
          <p className="text-sm">No opportunities yet — run a scan above, or wait for Monday&apos;s automatic run.</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((o) => (
            <Card key={o.id} className="p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full capitalize ${PLATFORM_COLORS[o.platform]}`}>
                      {o.platform}
                    </span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full capitalize ${STATUS_COLORS[o.status] ?? STATUS_COLORS.new}`}>
                      {o.status}
                    </span>
                    {o.url && (
                      <a href={o.url} target="_blank" rel="noopener" className="text-[10px] text-primary hover:underline inline-flex items-center gap-1">
                        Open <ExternalLink className="size-2.5" />
                      </a>
                    )}
                    <span className="text-[10px] text-muted-foreground">week of {o.week_start}</span>
                  </div>
                  <p className="font-medium text-sm mt-1.5">{o.title}</p>
                  {o.snippet && <p className="text-xs text-muted-foreground mt-1">{o.snippet}</p>}
                  {o.recommendation && (
                    <div className="mt-2 rounded-md bg-muted/50 p-2.5 text-xs">
                      <span className="font-semibold text-muted-foreground block mb-0.5">Recommended post:</span>
                      {o.recommendation}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0 flex-wrap">
                  <span className="text-xs font-semibold tabular-nums bg-blue-50 text-blue-700 dark:bg-blue-950 px-2 py-1 rounded-full">
                    {o.relevance_score}% fit
                  </span>
                  <select value={o.status} onChange={(e) => setStatus(o.id, e.target.value)}
                    className="rounded-md border border-input bg-background px-2 py-1.5 text-xs capitalize">
                    {["new", "drafted", "posted", "dismissed"].map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <button onClick={() => remove(o.id)} className="p-1.5 rounded hover:bg-red-100 dark:hover:bg-red-900 text-muted-foreground hover:text-red-600" title="Remove">
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
