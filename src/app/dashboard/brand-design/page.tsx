"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { BuyMoreTokens } from "@/components/dashboard/buy-more-tokens";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Palette, Sparkles, Download, ImageUp, X, BookOpen } from "lucide-react";
import { getTaskModelMappings } from "@/app/dashboard/settings/ai/actions";

interface BrandModel {
  id: string;
  model_identifier: string;
  provider?: { id: string; name: string; type?: string } | null;
}

const PERSONALITY_OPTIONS = [
  "Modern", "Minimal", "Luxurious", "Playful", "Bold",
  "Warm", "Tech-forward", "Handcrafted", "Elegant", "Edgy",
];

const DELIVERABLE_OPTIONS = [
  "Logo / Brand Mark", "Icon Set", "Brand Guidelines", "Social Media Kit",
  "Website Mockup", "Packaging Design", "Stationery / Business Cards", "Presentation Template",
];

const SIZES = [
  { label: "Square (1024×1024)", value: "1024x1024" },
  { label: "Landscape (1792×1024)", value: "1792x1024" },
  { label: "Portrait (1024×1792)", value: "1024x1792" },
];

interface BrandAnswers {
  business: string;
  industry: string;
  audience: string;
  personality: string[];
  colorPrimary: string;
  colorSecondary: string;
  colorAccent: string;
  keywords: string;
  deliverables: string[];
  notes: string;
}

function buildBrandBrief(a: BrandAnswers): string {
  const brief: string[] = [
    "BRAND DESIGN BRIEF",
    a.business.trim() ? `Business/brand name: ${a.business.trim()}.` : "",
    a.industry.trim() ? `Industry: ${a.industry.trim()}.` : "",
    a.audience.trim() ? `Target audience: ${a.audience.trim()}.` : "",
    a.personality.length ? `Brand personality: ${a.personality.join(", ")}.` : "",
    [a.colorPrimary, a.colorSecondary, a.colorAccent]
      .filter((c) => c && c.trim())
      .length
      ? `Core color palette (hex): ${[a.colorPrimary, a.colorSecondary, a.colorAccent]
          .filter((c) => c && c.trim())
          .join(", ")}.`
      : "",
    a.keywords.trim() ? `Style keywords: ${a.keywords.trim()}.` : "",
    a.deliverables.length ? `Deliverable(s): ${a.deliverables.join(", ")}.` : "",
    a.notes.trim() ? `Additional direction: ${a.notes.trim()}.` : "",
  ].filter(Boolean);

  const visual = [
    "Create a high-quality brand-design asset: clean, scalable, vector-style art with strong typography, a cohesive brand color palette, clear visual hierarchy, and precise text rendered exactly as spelled.",
    "Stick strictly to the palette, personality, and deliverables above. No watermarks, no placeholder boxes, no lorem ipsum.",
  ];

  return brief.join("\n") + "\n\n" + visual.join(" ");
}

interface GeneratedImage {
  url: string;
  revisedPrompt: string | null;
}

export default function BrandDesignPage() {
  const [answers, setAnswers] = useState<BrandAnswers>({
    business: "", industry: "", audience: "",
    personality: [], colorPrimary: "", colorSecondary: "", colorAccent: "",
    keywords: "", deliverables: [], notes: "",
  });
  const [models, setModels] = useState<BrandModel[]>([]);
  const [modelId, setModelId] = useState<string>("");
  const [size, setSize] = useState("1024x1024");
  const [referenceImage, setReferenceImage] = useState<string | null>(null);
  const [referenceError, setReferenceError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [buyMoreTokens, setBuyMoreTokens] = useState<string | null>(null);
  const [images, setImages] = useState<GeneratedImage[]>([]);
  // Previous brand assets saved to the workspace (see /dashboard/assets).
  const [history, setHistory] = useState<{ id: string; url: string; prompt: string; created_at: string }[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const set = (key: keyof BrandAnswers, value: unknown) =>
    setAnswers((prev) => ({ ...prev, [key]: value }));

  const toggleIn = (key: "personality" | "deliverables", value: string) =>
    setAnswers((prev) => {
      const list = prev[key];
      return {
        ...prev,
        [key]: list.includes(value)
          ? list.filter((v) => v !== value)
          : [...list, value],
      };
    });

  // Load the model list for brand work + the tenant's saved brand_design
  // mapping so the picker can default sensibly.
  const loadModels = useCallback(async () => {
    try {
      const [modelRes, mapRes] = await Promise.all([
        fetch("/api/ai/models?task=brand_design", { credentials: "include" }),
        getTaskModelMappings(),
      ]);
      if (modelRes.ok) {
        const data = await modelRes.json();
        const list: BrandModel[] = (data.models ?? []).filter(
          (m: any) => !m.is_deprecated
        );
        setModels(list);
        let def = "";
        if (mapRes.success && mapRes.data) {
          const mapped = mapRes.data.find((m) => m.task === "brand_design");
          if (mapped && list.some((m) => m.id === mapped.model_id)) {
            def = mapped.model_id;
          }
        }
        // No saved mapping → auto-default to Recraft V3 (vector-native) if
        // it's available, otherwise leave "Auto" (task mapping) selected.
        if (!def) {
          const recraft = list.find((m) =>
            m.model_identifier.toLowerCase().includes("recraft")
          );
          if (recraft) def = recraft.id;
        }
        setModelId(def);
      }
    } catch {
      // Models optional — generation still works via the task mapping.
    }
  }, []);

  useEffect(() => {
    loadModels();
  }, [loadModels]);

  // Load previously generated brand assets so results are never lost after
  // leaving the page — they live in the workspace asset library.
  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch("/api/assets?type=image&task=brand_design&limit=12", {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setHistory(data.assets ?? []);
      }
    } catch {
      // history optional
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const handleReferenceFile = (file: File | undefined | null) => {
    setReferenceError(null);
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setReferenceError("Please select an image file (PNG, JPG, GIF, WEBP).");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setReferenceError("Image must be 5MB or smaller.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setReferenceImage(reader.result as string);
    reader.onerror = () => setReferenceError("Failed to read the image file.");
    reader.readAsDataURL(file);
  };

  const handleGenerate = async () => {
    const prompt = buildBrandBrief(answers);
    if (!prompt.trim()) {
      setError("Fill in at least one field of the brief (e.g. the business name) so the design has direction.");
      return;
    }
    setLoading(true);
    setError(null);
    setImages([]);
    try {
      const res = await fetch("/api/generate-image", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          size,
          n: 1,
          referenceImage: referenceImage ?? undefined,
          task: "brand_design",
          modelId: modelId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.buyMoreTokens) setBuyMoreTokens(data.error ?? null);
        else setError(data.error ?? "Failed to generate brand assets.");
        return;
      }
      if (data.images) setImages(data.images);
      loadHistory();
    } catch (err: any) {
      setError(err.message ?? "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async (url: string, index: number) => {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `brand-asset-${index + 1}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch {
      // ignore — lightbox is still available
    }
  };

  const briefComplete = Boolean(
    answers.business.trim() || answers.industry.trim() ||
    answers.audience.trim() || answers.keywords.trim() ||
    answers.personality.length || answers.deliverables.length
  );

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Palette className="size-6 text-primary" />
          Brand &amp; Vector Design
        </h1>
        <p className="text-muted-foreground mt-1 max-w-3xl">
          Build full brand stylesheets, layouts, and mockups from a structured
          brief plus inspiration images. Bilbo — the lead brand &amp; vector
          designer — turns your answers into precise visual direction, and your
          workspace brand profile and knowledge base are automatically pulled in
          as context.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* -------- Questionnaire -------- */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Brand Brief</CardTitle>
            <CardDescription>
              The more you answer, the more on-brand the result. Every field is
              optional — the system fills gaps from your workspace knowledge base.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label htmlFor="bb-business" className="block text-sm font-medium mb-1.5">Business / brand name</label>
              <input
                id="bb-business"
                value={answers.business}
                onChange={(e) => set("business", e.target.value)}
                placeholder="e.g. Maple & Oak Coffee Roasters"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="bb-industry" className="block text-sm font-medium mb-1.5">Industry</label>
                <input
                  id="bb-industry"
                  value={answers.industry}
                  onChange={(e) => set("industry", e.target.value)}
                  placeholder="e.g. Specialty coffee"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label htmlFor="bb-audience" className="block text-sm font-medium mb-1.5">Target audience</label>
                <input
                  id="bb-audience"
                  value={answers.audience}
                  onChange={(e) => set("audience", e.target.value)}
                  placeholder="e.g. Remote workers 25-45"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5">Brand personality</label>
              <div className="flex flex-wrap gap-1.5">
                {PERSONALITY_OPTIONS.map((opt) => {
                  const active = answers.personality.includes(opt);
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => toggleIn("personality", opt)}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                        active
                          ? "bg-primary text-primary-foreground border-primary"
                          : "border-border text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5">Core color palette (hex)</label>
              <div className="grid grid-cols-3 gap-3">
                {(["colorPrimary", "colorSecondary", "colorAccent"] as const).map((key) => (
                  <div key={key} className="flex items-center gap-1.5">
                    <input
                      type="color"
                      value={answers[key] || "#ffffff"}
                      onChange={(e) => set(key, e.target.value)}
                      className="h-9 w-9 rounded-md border border-input cursor-pointer bg-background p-0.5"
                      title={key.replace("color", "")}
                    />
                    <input
                      value={answers[key]}
                      onChange={(e) => set(key, e.target.value)}
                      placeholder={key === "colorPrimary" ? "Primary" : key === "colorSecondary" ? "Secondary" : "Accent"}
                      className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs font-mono"
                    />
                  </div>
                ))}
              </div>
            </div>

            <div>
              <label htmlFor="bb-keywords" className="block text-sm font-medium mb-1.5">Style keywords</label>
              <input
                id="bb-keywords"
                value={answers.keywords}
                onChange={(e) => set("keywords", e.target.value)}
                placeholder="e.g. warm, handcrafted, editorial, premium"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5">What should this create?</label>
              <div className="flex flex-wrap gap-1.5">
                {DELIVERABLE_OPTIONS.map((opt) => {
                  const active = answers.deliverables.includes(opt);
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => toggleIn("deliverables", opt)}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                        active
                          ? "bg-primary text-primary-foreground border-primary"
                          : "border-border text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label htmlFor="bb-notes" className="block text-sm font-medium mb-1.5">Additional direction</label>
              <textarea
                id="bb-notes"
                rows={3}
                value={answers.notes}
                onChange={(e) => set("notes", e.target.value)}
                placeholder="Layout ideas, references, mood, must-avoid elements..."
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-y"
              />
            </div>

            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground flex items-start gap-2">
              <BookOpen className="size-4 shrink-0 mt-0.5 text-primary" />
              <span>
                Your workspace <strong>brand profile</strong> (voice, tone, colors) and{" "}
                <strong>knowledge base</strong> are automatically merged into the
                brief before generation — no need to repeat what&apos;s already saved.
              </span>
            </div>
          </CardContent>
        </Card>

        {/* -------- Assets / generate -------- */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Inspiration &amp; Model</CardTitle>
            <CardDescription>
              Add a reference image (for image-to-image models) and pick which
              model generates the asset.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Inspiration image */}
            <div>
              <label className="block text-sm font-medium mb-1.5">Inspiration image (optional)</label>
              <div className="flex flex-wrap items-center gap-3">
                {referenceImage ? (
                  <div className="relative">
                    <img src={referenceImage} alt="Inspiration" className="h-24 w-24 object-cover rounded-md border" />
                    <button
                      onClick={() => setReferenceImage(null)}
                      className="absolute -top-2 -right-2 p-0.5 rounded-full bg-red-500 text-white hover:bg-red-600"
                      title="Remove inspiration image"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                ) : (
                  <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                    <ImageUp className="size-3.5 mr-1" /> Upload Image
                  </Button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => handleReferenceFile(e.target.files?.[0])}
                />
                <span className="text-xs text-muted-foreground">Max 5MB. Passed to image-to-image models.</span>
              </div>
              {referenceError && (
                <div className="mt-2 p-2 rounded-md bg-destructive/10 text-destructive text-xs">{referenceError}</div>
              )}
            </div>

            {/* Model picker */}
            <div>
              <label htmlFor="bb-model" className="block text-sm font-medium mb-1.5">Model</label>
              <select
                id="bb-model"
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">Auto (task mapping)</option>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.model_identifier} {m.provider ? `(${m.provider.name})` : ""}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground mt-1">
                {modelId
                  ? "Using your explicit pick — it must have a connected provider key."
                  : "Uses the Brand & Vector Design task mapping (or the best available image provider)."}
              </p>
            </div>

            <div>
              <label htmlFor="bb-size" className="block text-sm font-medium mb-1.5">Aspect ratio</label>
              <select id="bb-size" value={size} onChange={(e) => setSize(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                {SIZES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>

            {error && (
              <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm">{error}</div>
            )}

            {buyMoreTokens && <BuyMoreTokens message={buyMoreTokens} />}

            <Button
              onClick={handleGenerate}
              disabled={loading || !briefComplete}
              className="w-full"
            >
              {loading ? (
                <><Loader2 className="size-4 animate-spin mr-2" />Designing...</>
              ) : (
                <><Sparkles className="size-4 mr-2" />Generate Brand Asset</>
              )}
            </Button>
            {!briefComplete && (
              <p className="text-xs text-muted-foreground">
                Answer at least one field above to give the design direction.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* -------- Previous brand assets -------- */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Previous brand assets</h2>
          <a href="/dashboard/assets?kind=brand" className="text-sm text-primary underline hover:underline">
            Open Asset Library →
          </a>
        </div>
        {historyLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : history.length === 0 ? (
          <div className="rounded-lg border bg-card p-8 text-center text-muted-foreground">
            <p className="text-sm">No saved brand assets yet.</p>
            <p className="text-xs mt-1">
              Every asset you generate is saved to your workspace — find it here or in the Asset Library.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
            {history.map((h) => (
              <Card key={h.id} className="overflow-hidden">
                <div className="aspect-square bg-muted relative">
                  <img
                    src={h.url}
                    alt={h.prompt}
                    className="w-full h-full object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                </div>
                <div className="p-2.5">
                  <p className="text-xs text-muted-foreground line-clamp-2" title={h.prompt}>{h.prompt}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {new Date(h.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </p>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* -------- Results -------- */}
      {images.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-4">Results</h2>
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
            {images.map((img, i) => (
              <Card key={i} className="overflow-hidden">
                <div className="aspect-square bg-muted relative group">
                  <img
                    src={img.url}
                    alt={img.revisedPrompt ?? `Brand asset ${i + 1}`}
                    className="w-full h-full object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                </div>
                <div className="p-3 space-y-1">
                  <div className="flex items-center justify-between">
                    <Badge variant="secondary">Brand asset {i + 1}</Badge>
                    <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => handleDownload(img.url, i)}>
                      <Download className="size-3 mr-1" />Download
                    </Button>
                  </div>
                  {img.revisedPrompt && (
                    <p className="text-xs text-muted-foreground line-clamp-2 italic">{img.revisedPrompt}</p>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
