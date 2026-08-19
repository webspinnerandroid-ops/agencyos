"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Loader2,
  Save,
  RotateCcw,
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  LayoutTemplate,
  Bot,
  Send,
  ExternalLink,
  MessageSquare,
} from "lucide-react";
import {
  DEFAULT_LANDING_CONTENT,
  type LandingContent,
  type LandingFeature,
  type LandingStep,
  type LandingTestimonial,
  type LandingFaq,
  type LandingLogo,
  type LandingPlan,
  type LandingHub,
  type LandingPage,
  type LandingNavLink,
} from "@/lib/landing-content";
import type { PlanPriceStatus, HubPriceStatus } from "@/lib/stripe-pricing";
import { renderBlogBody } from "@/lib/blog-render";

// ---------------------------------------------------------------------------
// Small form helpers (Input/textarea/Field) shared across the builder.
// ---------------------------------------------------------------------------

function Field({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function AreaField({
  label,
  value,
  onChange,
  rows = 3,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-y"
      />
    </div>
  );
}

/** Inline status chip showing whether a plan/hub price is synced to Stripe. */
function PriceStatusBadge({
  live,
  drift,
}: {
  live: { price: string } | null;
  drift: boolean;
}) {
  if (!live) {
    return (
      <span
        className="inline-flex items-center rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 border border-amber-200"
        title="No active Stripe monthly price found for this id"
      >
        No Stripe price
      </span>
    );
  }
  if (drift) {
    return (
      <span
        className="inline-flex items-center rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-700 border border-red-200"
        title={`Stored price differs from the active Stripe price ($${live.price})`}
      >
        Drift — Stripe ${live.price}
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center rounded bg-green-50 px-1.5 py-0.5 text-[10px] font-medium text-green-700 border border-green-200"
      title={`Synced to Stripe — $${live.price}/mo`}
    >
      Synced — ${live.price}/mo
    </span>
  );
}

/** Renders the engineer's markdown reply, with fenced code blocks as <pre>. */
function renderChatReply(markdown: string): React.ReactNode {
  const parts = markdown.split(/```/);
  return parts.map((part, i) => {
    if (i % 2 === 1) {
      // Strip the leading language tag (```tsx ... ) for display.
      const code = part.replace(/^[a-zA-Z0-9_+-]*\s*\n?/, "");
      return (
        <pre
          key={i}
          className="my-2 overflow-x-auto rounded-md bg-muted p-3 text-[11px] leading-relaxed whitespace-pre"
        >
          <code>{code}</code>
        </pre>
      );
    }
    if (!part.trim()) return null;
    return (
      <div
        key={i}
        className="text-sm leading-relaxed [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1 [&_h1]:text-lg [&_h2]:text-base [&_h2]:font-semibold [&_h3]:text-sm [&_h3]:font-semibold [&_code]:rounded [&_code]:bg-muted [&_code]:px-1"
        dangerouslySetInnerHTML={{ __html: renderBlogBody(part) }}
      />
    );
  });
}

export default function PageBuilderPage() {
  const [content, setContent] = useState<LandingContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Live Stripe price status for each plan/hub (drift + missing detection).
  const [pricing, setPricing] = useState<{
    plans: PlanPriceStatus[];
    hubs: HubPriceStatus[];
  }>({ plans: [], hubs: [] });

  // "Add plan / hub" forms — create the Stripe product + price in the same save.
  const [newPlan, setNewPlan] = useState({
    name: "",
    price: "",
    description: "",
    features: "",
    popular: false,
  });
  const [newHub, setNewHub] = useState({ name: "", price: "", blurb: "" });
  const [creating, setCreating] = useState(false);
  const [newPage, setNewPage] = useState({ title: "", slug: "", body: "" });
  const [newNavLink, setNewNavLink] = useState({ label: "", href: "" });

  // Builder AI chat state.
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/page-builder", { credentials: "include" });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({ type: "error", message: data.error ?? "Failed to load content" });
        setContent(DEFAULT_LANDING_CONTENT);
      } else {
        setContent(data.content ?? DEFAULT_LANDING_CONTENT);
        setPricing(data.pricing ?? { plans: [], hubs: [] });
      }
    } catch {
      setFeedback({ type: "error", message: "Failed to load content" });
      setContent(DEFAULT_LANDING_CONTENT);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" });
  }, [chatMessages.length, chatLoading]);

  const patch = <K extends keyof LandingContent>(key: K, value: LandingContent[K]) =>
    setContent((prev) => (prev ? { ...prev, [key]: value } : prev));

  const save = async () => {
    if (!content) return;
    setSaving(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/admin/page-builder", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({ type: "error", message: data.error ?? "Failed to save" });
      } else {
        setFeedback({ type: "success", message: "Saved — the public landing page is live with these changes." });
      }
    } catch {
      setFeedback({ type: "error", message: "Failed to save" });
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    if (!confirm("Reset every field to the compiled defaults?")) return;
    setContent(DEFAULT_LANDING_CONTENT);
    setFeedback({ type: "success", message: "Defaults restored — press Save to publish." });
  };

  const slugify = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

  const addPage = () => {
    if (!content) return;
    const title = newPage.title.trim();
    const slug = (newPage.slug.trim() || slugify(title)).toLowerCase();
    if (!title) {
      setFeedback({ type: "error", message: "Page title is required." });
      return;
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      setFeedback({ type: "error", message: "Slug may only contain lowercase letters, numbers, and dashes." });
      return;
    }
    if (content.pages.some((p) => p.slug === slug)) {
      setFeedback({ type: "error", message: `A page with slug "${slug}" already exists.` });
      return;
    }
    patch("pages", [...content.pages, { slug, title, body: newPage.body }]);
    setNewPage({ title: "", slug: "", body: "" });
    setFeedback({ type: "success", message: `Page added — live at /p/${slug} once you Save.` });
  };

  const addNavLink = () => {
    if (!content) return;
    const label = newNavLink.label.trim();
    const href = newNavLink.href.trim();
    if (!label || !href.startsWith("/") || href.includes("://")) {
      setFeedback({ type: "error", message: "A label and a same-site path (starting with /) are required." });
      return;
    }
    patch("navLinks", [...content.navLinks, { label, href }]);
    setNewNavLink({ label: "", href: "" });
  };

  const planStatus = (planId: string) => pricing.plans.find((p) => p.planId === planId);
  const hubStatus = (hubId: string) => pricing.hubs.find((h) => h.hubId === hubId);

  const addPlan = async () => {
    const priceCents = Math.round(parseFloat(newPlan.price) * 100);
    if (!newPlan.name.trim() || !Number.isFinite(priceCents) || priceCents <= 0) {
      setFeedback({ type: "error", message: "Plan name and a positive monthly price are required." });
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/admin/page-builder/pricing", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "plan",
          name: newPlan.name.trim(),
          priceCents,
          description: newPlan.description,
          features: newPlan.features.split("\n").map((f) => f.trim()).filter(Boolean),
          popular: newPlan.popular,
          content,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({ type: "error", message: data.error ?? "Failed to create plan" });
      } else {
        setContent(data.content ?? content);
        setPricing(data.pricing ?? pricing);
        setNewPlan({ name: "", price: "", description: "", features: "", popular: false });
        setFeedback({ type: "success", message: "Plan created — Stripe product + monthly price live, and it's on the landing page." });
      }
    } catch {
      setFeedback({ type: "error", message: "Failed to create plan" });
    } finally {
      setCreating(false);
    }
  };

  const addHub = async () => {
    const priceCents = Math.round(parseFloat(newHub.price) * 100);
    if (!newHub.name.trim() || !Number.isFinite(priceCents) || priceCents <= 0) {
      setFeedback({ type: "error", message: "Hub name and a positive monthly price are required." });
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/admin/page-builder/pricing", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "hub",
          name: newHub.name.trim(),
          priceCents,
          blurb: newHub.blurb,
          content,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({ type: "error", message: data.error ?? "Failed to create hub" });
      } else {
        setContent(data.content ?? content);
        setPricing(data.pricing ?? pricing);
        setNewHub({ name: "", price: "", blurb: "" });
        setFeedback({ type: "success", message: "Hub created — Stripe product + monthly price live, and it's on the landing page." });
      }
    } catch {
      setFeedback({ type: "error", message: "Failed to create hub" });
    } finally {
      setCreating(false);
    }
  };

  const sendChat = async () => {
    const message = chatInput.trim();
    if (!message || chatLoading) return;
    setChatInput("");
    setChatMessages((prev) => [...prev, { role: "user", content: message }]);
    setChatLoading(true);
    try {
      const res = await fetch("/api/admin/page-builder/chat", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          history: chatMessages.slice(-8).map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setChatMessages((prev) => [
          ...prev,
          { role: "assistant", content: `⚠️ ${data.error ?? "The engineer could not respond."}` },
        ]);
      } else {
        setChatMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
      }
    } catch {
      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", content: "⚠️ Network error — please try again." },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  if (loading || !content) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="size-8 animate-spin mr-3" /> Loading page builder…
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <LayoutTemplate className="size-7 text-primary" /> Page Builder
          </h1>
          <p className="text-muted-foreground mt-1">
            Edit the public landing page copy and logo strip. Save publishes immediately.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setChatOpen((v) => !v)}>
            <MessageSquare className="size-4 mr-1.5" /> {chatOpen ? "Hide Engineer" : "Builder Engineer"}
          </Button>
          <a href="/" target="_blank" rel="noreferrer">
            <Button variant="ghost">
              <ExternalLink className="size-4 mr-1.5" /> View site
            </Button>
          </a>
          <Button variant="ghost" onClick={reset} disabled={saving}>
            <RotateCcw className="size-4 mr-1.5" /> Reset
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin mr-1.5" /> : <Save className="size-4 mr-1.5" />}
            Save
          </Button>
        </div>
      </div>

      {feedback && (
        <div className={`p-3 rounded-md text-sm border ${feedback.type === "success" ? "bg-green-50 text-green-700 border-green-200" : "bg-red-50 text-red-700 border-red-200"}`} role="alert">
          {feedback.message}
          <button className="ml-3 underline text-xs" onClick={() => setFeedback(null)}>Dismiss</button>
        </div>
      )}

      {/* Builder AI chat — attached so the admin can ask for custom pieces. */}
      {chatOpen && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Bot className="size-4 text-primary" /> Builder Engineer
            </CardTitle>
            <CardDescription>
              Describe a custom piece of the site (a section, an effect, an embed) and the
              engineer returns the code plus step-by-step deployment instructions.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div ref={chatRef} className="space-y-3 max-h-72 overflow-y-auto rounded-md border bg-muted/20 p-3">
              {chatMessages.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Try: &ldquo;Add an animated stats counter strip between the hero and the
                  product tour, counting 3,000+ posts published.&rdquo;
                </p>
              )}
              {chatMessages.map((m, i) => (
                <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                    {m.role === "user" ? (
                      <p className="whitespace-pre-wrap">{m.content}</p>
                    ) : (
                      renderChatReply(m.content)
                    )}
                  </div>
                </div>
              ))}
              {chatLoading && (
                <div className="flex items-center gap-2 text-muted-foreground text-xs">
                  <Loader2 className="size-3.5 animate-spin" /> Engineer is working…
                </div>
              )}
            </div>
            <div className="flex items-end gap-2">
              <textarea
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void sendChat();
                  }
                }}
                rows={2}
                placeholder="Ask the engineer to build something… (Enter to send)"
                className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <Button onClick={sendChat} disabled={!chatInput.trim() || chatLoading}>
                <Send className="size-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Hero */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Hero</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Headline" value={content.heroTitle} onChange={(v) => patch("heroTitle", v)} />
          <AreaField label="Subheadline" value={content.heroSubtitle} onChange={(v) => patch("heroSubtitle", v)} />
          <Field label="Badge line (under the buttons)" value={content.heroBadge} onChange={(v) => patch("heroBadge", v)} />
        </CardContent>
      </Card>

      {/* Features */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Features</CardTitle>
          <CardDescription>Shown as an icon grid. Icons cycle automatically.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Section heading" value={content.featuresHeading} onChange={(v) => patch("featuresHeading", v)} />
          <AreaField label="Section subheading" value={content.featuresSubheading} onChange={(v) => patch("featuresSubheading", v)} />
          {content.features.map((f: LandingFeature, i: number) => (
            <div key={i} className="rounded-md border p-3 space-y-2">
              <div className="flex items-center gap-1">
                <span className="text-xs font-medium text-muted-foreground">Feature {i + 1}</span>
                <div className="ml-auto flex items-center gap-0.5">
                  <Button variant="ghost" size="sm" disabled={i === 0} onClick={() => patch("features", [...content.features.slice(0, i - 1), content.features[i], content.features[i - 1], ...content.features.slice(i + 1)])} title="Move up"><ChevronUp className="size-3.5" /></Button>
                  <Button variant="ghost" size="sm" disabled={i === content.features.length - 1} onClick={() => patch("features", [...content.features.slice(0, i), content.features[i + 1], content.features[i], ...content.features.slice(i + 2)])} title="Move down"><ChevronDown className="size-3.5" /></Button>
                  <Button variant="ghost" size="sm" className="text-destructive" onClick={() => patch("features", content.features.filter((_, j) => j !== i))} title="Remove"><Trash2 className="size-3.5" /></Button>
                </div>
              </div>
              <Input value={f.title} onChange={(e) => patch("features", content.features.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} placeholder="Title" />
              <textarea value={f.description} onChange={(e) => patch("features", content.features.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} rows={2} placeholder="Description" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-y" />
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => patch("features", [...content.features, { title: "New feature", description: "" }])}>
            <Plus className="size-3.5 mr-1" /> Add feature
          </Button>
        </CardContent>
      </Card>

      {/* How it works */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">How it works</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Section heading" value={content.howItWorksHeading} onChange={(v) => patch("howItWorksHeading", v)} />
          <AreaField label="Section subheading" value={content.howItWorksSubheading} onChange={(v) => patch("howItWorksSubheading", v)} />
          {content.howItWorks.map((s: LandingStep, i: number) => (
            <div key={i} className="rounded-md border p-3 space-y-2">
              <div className="flex items-center gap-1">
                <span className="text-xs font-medium text-muted-foreground">Step {i + 1}</span>
                <div className="ml-auto">
                  <Button variant="ghost" size="sm" className="text-destructive" onClick={() => patch("howItWorks", content.howItWorks.filter((_, j) => j !== i))} title="Remove"><Trash2 className="size-3.5" /></Button>
                </div>
              </div>
              <div className="grid grid-cols-[80px_1fr] gap-2">
                <Input value={s.step} onChange={(e) => patch("howItWorks", content.howItWorks.map((x, j) => (j === i ? { ...x, step: e.target.value } : x)))} placeholder="01" />
                <Input value={s.title} onChange={(e) => patch("howItWorks", content.howItWorks.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} placeholder="Title" />
              </div>
              <textarea value={s.description} onChange={(e) => patch("howItWorks", content.howItWorks.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} rows={2} placeholder="Description" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-y" />
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => patch("howItWorks", [...content.howItWorks, { step: String(content.howItWorks.length + 1).padStart(2, "0"), title: "New step", description: "" }])}>
            <Plus className="size-3.5 mr-1" /> Add step
          </Button>
        </CardContent>
      </Card>

      {/* Pricing plans */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pricing plans</CardTitle>
          <CardDescription>
            Display copy for the all-in-one tiers. Prices are read live from Stripe&apos;s
            active monthly price (read-only) — reprice in Stripe and the site follows
            automatically. The plan ID is the sync key matched to product{" "}
            <code>plan_id</code> metadata at checkout.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Section heading" value={content.pricingHeading} onChange={(v) => patch("pricingHeading", v)} />
          <AreaField label="Section subheading" value={content.pricingSubheading} onChange={(v) => patch("pricingSubheading", v)} />
          {content.plans.map((p: LandingPlan, i: number) => (
            <div key={p.planId} className="rounded-md border p-3 space-y-2">
              <div className="flex items-center gap-1">
                <span className="text-xs font-medium text-muted-foreground">Plan {i + 1}</span>
                <span className="ml-2 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground" title="Stripe plan ID (sync key)">
                  {p.planId}
                </span>
                <div className="ml-auto flex items-center gap-0.5">
                  <Button variant="ghost" size="sm" disabled={i === 0} onClick={() => patch("plans", [...content.plans.slice(0, i - 1), content.plans[i], content.plans[i - 1], ...content.plans.slice(i + 1)])} title="Move up"><ChevronUp className="size-3.5" /></Button>
                  <Button variant="ghost" size="sm" disabled={i === content.plans.length - 1} onClick={() => patch("plans", [...content.plans.slice(0, i), content.plans[i + 1], content.plans[i], ...content.plans.slice(i + 2)])} title="Move down"><ChevronDown className="size-3.5" /></Button>
                  <Button variant="ghost" size="sm" className="text-destructive" onClick={() => patch("plans", content.plans.filter((_, j) => j !== i))} title="Remove from page"><Trash2 className="size-3.5" /></Button>
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <PriceStatusBadge
                  live={planStatus(p.planId)?.live ?? null}
                  drift={planStatus(p.planId)?.drift ?? false}
                />
                <span>Price is driven by Stripe — edit the amount in Stripe.</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <Input value={p.name} onChange={(e) => patch("plans", content.plans.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="Plan name" />
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                  <Input value={p.price} readOnly className="pl-7 bg-muted/50" title="Live Stripe price (read-only)" />
                </div>
              </div>
              <Input value={p.description} onChange={(e) => patch("plans", content.plans.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} placeholder="Short description" />
              <textarea
                value={p.features.join("\n")}
                onChange={(e) => patch("plans", content.plans.map((x, j) => (j === i ? { ...x, features: e.target.value.split("\n") } : x)))}
                rows={5}
                placeholder="One feature per line"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-y"
              />
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={!!p.popular}
                  onChange={(e) => patch("plans", content.plans.map((x, j) => (j === i ? { ...x, popular: e.target.checked } : x)))}
                  className="size-4 rounded border-input"
                />
                Mark as &ldquo;Most Popular&rdquo;
              </label>
            </div>
          ))}

          {/* Create a new plan (creates the Stripe product + price too) */}
          <div className="rounded-md border border-dashed p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Plus className="size-3.5 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground">Add a new plan</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Input value={newPlan.name} onChange={(e) => setNewPlan((s) => ({ ...s, name: e.target.value }))} placeholder="Plan name (e.g. Enterprise)" />
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                <Input value={newPlan.price} onChange={(e) => setNewPlan((s) => ({ ...s, price: e.target.value }))} placeholder="199 /mo" className="pl-7" inputMode="decimal" />
              </div>
            </div>
            <Input value={newPlan.description} onChange={(e) => setNewPlan((s) => ({ ...s, description: e.target.value }))} placeholder="Short description" />
            <textarea value={newPlan.features} onChange={(e) => setNewPlan((s) => ({ ...s, features: e.target.value }))} rows={3} placeholder="One feature per line" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-y" />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={newPlan.popular} onChange={(e) => setNewPlan((s) => ({ ...s, popular: e.target.checked }))} className="size-4 rounded border-input" />
              Mark as &ldquo;Most Popular&rdquo;
            </label>
            <Button size="sm" onClick={addPlan} disabled={creating}>
              {creating ? <Loader2 className="size-3.5 animate-spin mr-1.5" /> : <Plus className="size-3.5 mr-1.5" />}
              Create plan in Stripe
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Hub add-ons */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Hub add-ons</CardTitle>
          <CardDescription>
            The a-la-carte hub cards. Prices are read live from Stripe&apos;s active monthly
            price (read-only). Hub IDs are the sync keys matched to product{" "}
            <code>hub_id</code> metadata at checkout.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Section heading" value={content.hubsHeading} onChange={(v) => patch("hubsHeading", v)} />
          <AreaField label="Section subheading" value={content.hubsSubheading} onChange={(v) => patch("hubsSubheading", v)} />
          {content.hubs.map((h: LandingHub, i: number) => (
            <div key={h.hubId} className="rounded-md border p-3 space-y-2">
              <div className="flex items-center gap-1">
                <span className="text-xs font-medium text-muted-foreground">Hub {i + 1}</span>
                <span className="ml-2 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground" title="Stripe hub ID (sync key)">
                  {h.hubId}
                </span>
                <div className="ml-auto flex items-center gap-0.5">
                  <Button variant="ghost" size="sm" disabled={i === 0} onClick={() => patch("hubs", [...content.hubs.slice(0, i - 1), content.hubs[i], content.hubs[i - 1], ...content.hubs.slice(i + 1)])} title="Move up"><ChevronUp className="size-3.5" /></Button>
                  <Button variant="ghost" size="sm" disabled={i === content.hubs.length - 1} onClick={() => patch("hubs", [...content.hubs.slice(0, i), content.hubs[i + 1], content.hubs[i], ...content.hubs.slice(i + 2)])} title="Move down"><ChevronDown className="size-3.5" /></Button>
                  <Button variant="ghost" size="sm" className="text-destructive" onClick={() => patch("hubs", content.hubs.filter((_, j) => j !== i))} title="Remove from page"><Trash2 className="size-3.5" /></Button>
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <PriceStatusBadge
                  live={hubStatus(h.hubId)?.live ?? null}
                  drift={hubStatus(h.hubId)?.drift ?? false}
                />
                <span>Price is driven by Stripe — edit the amount in Stripe.</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <Input value={h.name} onChange={(e) => patch("hubs", content.hubs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="Hub name" />
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                  <Input value={h.price} readOnly className="pl-7 bg-muted/50" title="Live Stripe price (read-only)" />
                </div>
              </div>
              <Input value={h.blurb} onChange={(e) => patch("hubs", content.hubs.map((x, j) => (j === i ? { ...x, blurb: e.target.value } : x)))} placeholder="One-line blurb" />
            </div>
          ))}

          {/* Create a new hub (creates the Stripe product + price too) */}
          <div className="rounded-md border border-dashed p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Plus className="size-3.5 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground">Add a new hub add-on</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Input value={newHub.name} onChange={(e) => setNewHub((s) => ({ ...s, name: e.target.value }))} placeholder="Hub name (e.g. SEO Audits)" />
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                <Input value={newHub.price} onChange={(e) => setNewHub((s) => ({ ...s, price: e.target.value }))} placeholder="29 /mo" className="pl-7" inputMode="decimal" />
              </div>
            </div>
            <Input value={newHub.blurb} onChange={(e) => setNewHub((s) => ({ ...s, blurb: e.target.value }))} placeholder="One-line blurb" />
            <Button size="sm" onClick={addHub} disabled={creating}>
              {creating ? <Loader2 className="size-3.5 animate-spin mr-1.5" /> : <Plus className="size-3.5 mr-1.5" />}
              Create hub in Stripe
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Logo strip — the headline ask, with a live visual preview */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Client logo strip</CardTitle>
          <CardDescription>
            The &ldquo;trusted by&rdquo; strip under the product tour. Add client logos; each is a
            name + image URL (Bunny CDN or any https URL) with an optional link.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Strip heading" value={content.logoStripHeading} onChange={(v) => patch("logoStripHeading", v)} />
          {content.logos.length > 0 && (
            <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-4 rounded-md border bg-muted/30 p-4">
              {content.logos.map((l: LandingLogo, i: number) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i} src={l.url} alt={l.name} className="h-8 w-auto object-contain opacity-70" />
              ))}
            </div>
          )}
          {content.logos.map((l: LandingLogo, i: number) => (
            <div key={i} className="rounded-md border p-3 space-y-2">
              <div className="flex items-center gap-1">
                <span className="text-xs font-medium text-muted-foreground">Logo {i + 1}</span>
                <div className="ml-auto flex items-center gap-0.5">
                  <Button variant="ghost" size="sm" disabled={i === 0} onClick={() => patch("logos", [...content.logos.slice(0, i - 1), content.logos[i], content.logos[i - 1], ...content.logos.slice(i + 1)])} title="Move left"><ChevronUp className="size-3.5" /></Button>
                  <Button variant="ghost" size="sm" disabled={i === content.logos.length - 1} onClick={() => patch("logos", [...content.logos.slice(0, i), content.logos[i + 1], content.logos[i], ...content.logos.slice(i + 2)])} title="Move right"><ChevronDown className="size-3.5" /></Button>
                  <Button variant="ghost" size="sm" className="text-destructive" onClick={() => patch("logos", content.logos.filter((_, j) => j !== i))} title="Remove"><Trash2 className="size-3.5" /></Button>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <Input value={l.name} onChange={(e) => patch("logos", content.logos.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="Company name" />
                <Input value={l.url} onChange={(e) => patch("logos", content.logos.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} placeholder="https://…/logo.png" />
              </div>
              <Input value={l.href ?? ""} onChange={(e) => patch("logos", content.logos.map((x, j) => (j === i ? { ...x, href: e.target.value } : x)))} placeholder="Optional link (https://…)" />
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => patch("logos", [...content.logos, { name: "", url: "" }])}>
            <Plus className="size-3.5 mr-1" /> Add logo
          </Button>
        </CardContent>
      </Card>

      {/* Testimonials */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Testimonials</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Section heading" value={content.testimonialsHeading} onChange={(v) => patch("testimonialsHeading", v)} />
          {content.testimonials.map((t: LandingTestimonial, i: number) => (
            <div key={i} className="rounded-md border p-3 space-y-2">
              <div className="flex items-center gap-1">
                <span className="text-xs font-medium text-muted-foreground">Quote {i + 1}</span>
                <div className="ml-auto">
                  <Button variant="ghost" size="sm" className="text-destructive" onClick={() => patch("testimonials", content.testimonials.filter((_, j) => j !== i))} title="Remove"><Trash2 className="size-3.5" /></Button>
                </div>
              </div>
              <textarea value={t.quote} onChange={(e) => patch("testimonials", content.testimonials.map((x, j) => (j === i ? { ...x, quote: e.target.value } : x)))} rows={2} placeholder="Quote" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-y" />
              <Input value={t.author} onChange={(e) => patch("testimonials", content.testimonials.map((x, j) => (j === i ? { ...x, author: e.target.value } : x)))} placeholder="Author (e.g. Agency founder, Acme Media)" />
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => patch("testimonials", [...content.testimonials, { quote: "", author: "" }])}>
            <Plus className="size-3.5 mr-1" /> Add testimonial
          </Button>
        </CardContent>
      </Card>

      {/* FAQ */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">FAQ</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Section heading" value={content.faqHeading} onChange={(v) => patch("faqHeading", v)} />
          {content.faqs.map((f: LandingFaq, i: number) => (
            <div key={i} className="rounded-md border p-3 space-y-2">
              <div className="flex items-center gap-1">
                <span className="text-xs font-medium text-muted-foreground">Question {i + 1}</span>
                <div className="ml-auto">
                  <Button variant="ghost" size="sm" className="text-destructive" onClick={() => patch("faqs", content.faqs.filter((_, j) => j !== i))} title="Remove"><Trash2 className="size-3.5" /></Button>
                </div>
              </div>
              <Input value={f.q} onChange={(e) => patch("faqs", content.faqs.map((x, j) => (j === i ? { ...x, q: e.target.value } : x)))} placeholder="Question" />
              <textarea value={f.a} onChange={(e) => patch("faqs", content.faqs.map((x, j) => (j === i ? { ...x, a: e.target.value } : x)))} rows={2} placeholder="Answer" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-y" />
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => patch("faqs", [...content.faqs, { q: "", a: "" }])}>
            <Plus className="size-3.5 mr-1" /> Add FAQ
          </Button>
        </CardContent>
      </Card>

      {/* Pages */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pages</CardTitle>
          <CardDescription>
            Create standalone pages that live at /p/&lt;slug&gt; and add them to the header menu below.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {content.pages.length > 0 && (
            <div className="space-y-2">
              {content.pages.map((p: LandingPage, i: number) => (
                <div key={p.slug} className="flex items-center gap-2 rounded-md border p-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{p.title}</p>
                    <a href={`/p/${p.slug}`} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">/p/{p.slug}</a>
                  </div>
                  <Button variant="ghost" size="sm" className="text-destructive" onClick={() => patch("pages", content.pages.filter((_, j) => j !== i))} title="Remove"><Trash2 className="size-3.5" /></Button>
                </div>
              ))}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Title" value={newPage.title} onChange={(v) => setNewPage((s) => ({ ...s, title: v }))} hint="Slug auto-derives from the title if left blank." />
            <Field label="Slug" value={newPage.slug} onChange={(v) => setNewPage((s) => ({ ...s, slug: v.toLowerCase() }))} hint="Lowercase + dashes only." />
          </div>
          <AreaField label="Body (markdown)" value={newPage.body} onChange={(v) => setNewPage((s) => ({ ...s, body: v }))} rows={6} />
          <Button variant="outline" size="sm" onClick={addPage}>
            <Plus className="size-3.5 mr-1" /> Add page
          </Button>
        </CardContent>
      </Card>

      {/* Navigation links */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Header navigation</CardTitle>
          <CardDescription>
            Extra links shown in the landing page header (and mobile menu) after Features / How it works / Pricing / FAQ.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {content.navLinks.length > 0 && (
            <div className="space-y-2">
              {content.navLinks.map((l: LandingNavLink, i: number) => (
                <div key={i} className="flex items-center gap-2 rounded-md border p-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{l.label}</p>
                    <p className="text-xs text-muted-foreground truncate">{l.href}</p>
                  </div>
                  <Button variant="ghost" size="sm" className="text-destructive" onClick={() => patch("navLinks", content.navLinks.filter((_, j) => j !== i))} title="Remove"><Trash2 className="size-3.5" /></Button>
                </div>
              ))}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Label" value={newNavLink.label} onChange={(v) => setNewNavLink((s) => ({ ...s, label: v }))} />
            <Field label="Path" value={newNavLink.href} onChange={(v) => setNewNavLink((s) => ({ ...s, href: v }))} hint="e.g. /p/about — same-site paths only" />
          </div>
          <Button variant="outline" size="sm" onClick={addNavLink}>
            <Plus className="size-3.5 mr-1" /> Add link
          </Button>
        </CardContent>
      </Card>

      {/* CTA */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Bottom call-to-action</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Heading" value={content.ctaTitle} onChange={(v) => patch("ctaTitle", v)} />
          <AreaField label="Subheading" value={content.ctaSubtitle} onChange={(v) => patch("ctaSubtitle", v)} />
          <Field label="Button text" value={content.ctaButton} onChange={(v) => patch("ctaButton", v)} />
        </CardContent>
      </Card>

      <div className="flex items-center gap-2 pb-10">
        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2 className="size-4 animate-spin mr-1.5" /> : <Save className="size-4 mr-1.5" />}
          Save &amp; publish
        </Button>
        <a href="/" target="_blank" rel="noreferrer">
          <Button variant="outline">
            <ExternalLink className="size-4 mr-1.5" /> Open the live site
          </Button>
        </a>
      </div>
    </div>
  );
}
