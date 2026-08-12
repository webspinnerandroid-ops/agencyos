"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Loader2, Radar, Mail, ExternalLink, Trash2, Copy, Check } from "lucide-react";

interface Target {
  id: string;
  blog_name: string | null;
  blog_url: string;
  contact_email: string | null;
  relevance_score: number;
  authority_score: number;
  traffic_estimate: string | null;
  notes: string | null;
  status: string;
  pitch: string | null;
  created_at: string;
}

const STATUSES = ["discovered", "pitched", "accepted", "published", "rejected"] as const;

const STATUS_COLORS: Record<string, string> = {
  discovered: "bg-gray-100 text-gray-700",
  pitched: "bg-blue-100 text-blue-700",
  accepted: "bg-green-100 text-green-700",
  published: "bg-emerald-100 text-emerald-700",
  rejected: "bg-red-100 text-red-700",
};

function ScoreBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="flex items-center gap-1.5 min-w-[90px]">
      <div className="w-12 h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${value}%` }} />
      </div>
      <span className="text-xs font-semibold tabular-nums">{value}</span>
    </div>
  );
}

export default function OutreachPage() {
  const [targets, setTargets] = useState<Target[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [topic, setTopic] = useState("");
  const [keywords, setKeywords] = useState("");
  const [discovering, setDiscovering] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [pitchingId, setPitchingId] = useState<string | null>(null);
  const [pitchOpen, setPitchOpen] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pitchSiteName, setPitchSiteName] = useState("");

  const load = useCallback(async (status = "") => {
    setLoading(true);
    try {
      const res = await fetch(`/api/outreach${status ? `?status=${status}` : ""}`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setTargets(data.targets ?? []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const discover = async () => {
    if (!topic.trim()) return;
    setDiscovering(true);
    setMessage(null);
    try {
      const res = await fetch("/api/outreach/discover", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: topic.trim(),
          keywords: keywords.split(",").map((k) => k.trim()).filter(Boolean),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ type: "error", text: data.error ?? "Discovery failed" });
        return;
      }
      setMessage({ type: "success", text: data.message ?? "Discovery complete." });
      load();
    } catch (err: any) {
      setMessage({ type: "error", text: err.message ?? "Discovery failed" });
    } finally {
      setDiscovering(false);
    }
  };

  const draftPitch = async (target: Target) => {
    setPitchingId(target.id);
    setMessage(null);
    try {
      const res = await fetch(`/api/outreach/${target.id}/pitch`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteName: pitchSiteName.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ type: "error", text: data.error ?? "Pitch generation failed" });
        return;
      }
      setPitchOpen(target.id);
      load();
    } catch (err: any) {
      setMessage({ type: "error", text: err.message ?? "Pitch generation failed" });
    } finally {
      setPitchingId(null);
    }
  };

  const setStatus = async (id: string, status: string) => {
    const res = await fetch(`/api/outreach/${id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) load(statusFilter);
  };

  const remove = async (id: string) => {
    if (!confirm("Remove this target?")) return;
    await fetch(`/api/outreach/${id}`, { method: "DELETE", credentials: "include" });
    load(statusFilter);
  };

  const copyPitch = async (target: Target) => {
    try {
      await navigator.clipboard.writeText(target.pitch ?? "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  const target = (id: string) => targets.find((t) => t.id === id);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Guest Post Outreach</h1>
        <p className="text-muted-foreground mt-1">
          Discover relevant blogs that accept guest posts, draft personalized
          pitches, and track the pipeline. Scores are <strong>AI estimates</strong> — verify
          a blog's real authority before pitching.
        </p>
      </div>

      {message && (
        <div className={`p-3 rounded-md text-sm border ${message.type === "success" ? "bg-green-50 text-green-700 border-green-200" : "bg-red-50 text-red-700 border-red-200"}`}>
          {message.text}
        </div>
      )}

      {/* Discover */}
      <Card className="p-5">
        <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <Radar className="size-4 text-primary" /> Discover blogs for a niche
        </h2>
        <div className="flex gap-2 flex-wrap">
          <Input placeholder="Niche / topic — e.g. real estate marketing" value={topic}
            onChange={(e) => setTopic(e.target.value)} className="flex-1 min-w-[220px]" />
          <Input placeholder="Focus keywords (comma separated, optional)" value={keywords}
            onChange={(e) => setKeywords(e.target.value)} className="flex-1 min-w-[220px]" />
          <Button onClick={discover} disabled={discovering || !topic.trim()}>
            {discovering ? <Loader2 className="size-4 animate-spin mr-1" /> : <Radar className="size-4 mr-1" />}
            Discover
          </Button>
        </div>
      </Card>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => { setStatusFilter(""); load(""); }}
          className={`px-2.5 py-1 rounded-full text-xs border ${!statusFilter ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`}>
          All
        </button>
        {STATUSES.map((s) => (
          <button key={s} onClick={() => { setStatusFilter(s); load(s); }}
            className={`px-2.5 py-1 rounded-full text-xs border capitalize ${statusFilter === s ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`}>
            {s} ({targets.filter((t) => t.status === s).length})
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
      ) : targets.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground">
          <p className="text-sm">No targets yet — run a discovery for a niche above, or add blogs manually later.</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {targets.map((t) => (
            <Card key={t.id} className="p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <a href={t.blog_url} target="_blank" rel="noopener" className="font-medium text-sm hover:underline inline-flex items-center gap-1">
                      {t.blog_name ?? t.blog_url} <ExternalLink className="size-3" />
                    </a>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full capitalize ${STATUS_COLORS[t.status] ?? STATUS_COLORS.discovered}`}>
                      {t.status}
                    </span>
                  </div>
                  {t.notes && <p className="text-xs text-muted-foreground mt-1 max-w-2xl">{t.notes}</p>}
                  <div className="flex items-center gap-4 mt-2 flex-wrap text-xs">
                    <span className="text-muted-foreground">Relevance</span> <ScoreBar value={t.relevance_score} color="bg-blue-500" />
                    <span className="text-muted-foreground">Authority</span> <ScoreBar value={t.authority_score} color="bg-emerald-500" />
                    {t.traffic_estimate && <span className="text-muted-foreground">~{t.traffic_estimate}/mo</span>}
                    {t.contact_email && (
                      <a href={`mailto:${t.contact_email}`} className="text-primary hover:underline inline-flex items-center gap-1">
                        <Mail className="size-3" /> {t.contact_email}
                      </a>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 flex-wrap">
                  <Button size="sm" variant="outline" onClick={() => draftPitch(t)} disabled={pitchingId === t.id}>
                    {pitchingId === t.id ? <Loader2 className="size-3.5 animate-spin" /> : <Mail className="size-3.5 mr-1" />}
                    {t.pitch ? "Regenerate pitch" : "Draft pitch"}
                  </Button>
                  <select value={t.status} onChange={(e) => setStatus(t.id, e.target.value)}
                    className="rounded-md border border-input bg-background px-2 py-1.5 text-xs capitalize">
                    {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <button onClick={() => remove(t.id)} className="p-1.5 rounded hover:bg-red-100 dark:hover:bg-red-900 text-muted-foreground hover:text-red-600" title="Remove">
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>

              {pitchOpen === t.id && (
                <div className="mt-3 border-t pt-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">AI Draft Pitch</span>
                    <div className="flex items-center gap-2">
                      <Input placeholder="Your site/brand name (optional)" value={pitchSiteName} onChange={(e) => setPitchSiteName(e.target.value)} className="w-48 h-7 text-xs" />
                      <Button size="sm" variant="outline" onClick={() => copyPitch(t)}>
                        {copied ? <Check className="size-3.5 mr-1" /> : <Copy className="size-3.5 mr-1" />}
                        {copied ? "Copied" : "Copy"}
                      </Button>
                    </div>
                  </div>
                  <pre className="whitespace-pre-wrap text-xs bg-muted/50 rounded-md p-3 max-h-64 overflow-y-auto font-sans">
                    {target(t.id)?.pitch ?? t.pitch ?? "No pitch yet."}
                  </pre>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
