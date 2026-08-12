"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  Radar,
  Mail,
  Send,
  ExternalLink,
  Trash2,
  Copy,
  Check,
  CalendarRange,
  Reply,
} from "lucide-react";

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
  pitch_sent_at: string | null;
  last_reply_at: string | null;
  last_reply_text: string | null;
  reply_count: number;
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
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [campaignDiscovering, setCampaignDiscovering] = useState(false);
  const [logReplyId, setLogReplyId] = useState<string | null>(null);
  const [replyFrom, setReplyFrom] = useState("");
  const [replyText, setReplyText] = useState("");

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
    // Visiting the page counts as reading the replies — clear the dashboard
    // notification dot for this tenant.
    fetch("/api/outreach/mark-seen", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }).catch(() => {});
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

  const sendPitch = async (target: Target) => {
    setSendingId(target.id);
    setMessage(null);
    try {
      const res = await fetch(`/api/outreach/${target.id}/send`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ type: "error", text: data.error ?? "Send failed" });
        return;
      }
      setMessage({ type: "success", text: `Pitch sent to ${data.sentTo}. Replies are watched automatically.` });
      load(statusFilter);
    } catch (err: any) {
      setMessage({ type: "error", text: err.message ?? "Send failed" });
    } finally {
      setSendingId(null);
    }
  };

  const logReply = async (target: Target) => {
    if (!replyText.trim()) {
      setMessage({ type: "error", text: "Paste the reply text first." });
      return;
    }
    setMessage(null);
    try {
      const res = await fetch("/api/outreach/reply-webhook", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetId: target.id,
          from: replyFrom.trim() || target.blog_name || "unknown",
          subject: "",
          text: replyText.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ type: "error", text: data.error ?? "Could not log reply" });
        return;
      }
      setMessage({ type: "success", text: `Reply logged — status is now "${data.status}".` });
      setLogReplyId(null);
      setReplyText("");
      setReplyFrom("");
      load(statusFilter);
    } catch (err: any) {
      setMessage({ type: "error", text: err.message ?? "Could not log reply" });
    }
  };

  const discoverFromCampaign = async () => {
    setCampaignDiscovering(true);
    setMessage(null);
    try {
      const res = await fetch("/api/outreach/discover-from-campaign", {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ type: "error", text: data.error ?? "Discovery failed" });
        return;
      }
      setMessage({ type: "success", text: data.message });
      load();
    } catch (err: any) {
      setMessage({ type: "error", text: err.message ?? "Discovery failed" });
    } finally {
      setCampaignDiscovering(false);
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
          <Button variant="outline" onClick={discoverFromCampaign} disabled={campaignDiscovering}>
            {campaignDiscovering ? <Loader2 className="size-4 animate-spin mr-1" /> : <CalendarRange className="size-4 mr-1" />}
            Discover from campaign plan
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          "Discover from campaign plan" pulls the blog topics Malory mapped out in your
          campaigns and finds guest-post targets for those exact topics — outreach follows the roadmap.
        </p>
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
                    {t.reply_count > 0 && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300" title={`Last reply ${t.last_reply_at ? new Date(t.last_reply_at).toLocaleString() : ""}`}>
                        💬 {t.reply_count} repl{t.reply_count === 1 ? "y" : "ies"}
                      </span>
                    )}
                    {t.pitch_sent_at && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                        Pitched {new Date(t.pitch_sent_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </span>
                    )}
                  </div>
                  {t.notes && <p className="text-xs text-muted-foreground mt-1 max-w-2xl whitespace-pre-wrap">{t.notes}</p>}
                  {t.last_reply_text && (
                    <p className="text-xs mt-1 max-w-2xl rounded-md bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 p-2 whitespace-pre-wrap">
                      <span className="font-semibold text-amber-700 dark:text-amber-300">Latest reply:</span> {t.last_reply_text}
                    </p>
                  )}
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
                  {t.pitch && (
                    <Button size="sm" variant="default" onClick={() => sendPitch(t)} disabled={sendingId === t.id || !t.contact_email} title={!t.contact_email ? "This target has no contact email" : "Email the pitch via the platform"}>
                      {sendingId === t.id ? <Loader2 className="size-3.5 animate-spin mr-1" /> : <Send className="size-3.5 mr-1" />}
                      Send
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => setLogReplyId(logReplyId === t.id ? null : t.id)}>
                    <Reply className="size-3.5 mr-1" /> Log reply
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

              {logReplyId === t.id && (
                <div className="mt-3 border-t pt-3 space-y-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Log a reply</span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <Input placeholder="From (e.g. editor@theirblog.com)" value={replyFrom} onChange={(e) => setReplyFrom(e.target.value)} className="h-8 text-xs" />
                    <textarea
                      placeholder="Paste the reply text…"
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      rows={3}
                      className="rounded-md border border-input bg-background px-3 py-2 text-sm w-full"
                    />
                  </div>
                  <Button size="sm" onClick={() => logReply(t)}>
                    <Reply className="size-3.5 mr-1" /> Save reply
                  </Button>
                </div>
              )}

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
