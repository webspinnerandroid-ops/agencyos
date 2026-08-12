"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Loader2,
  Video,
  Sparkles,
  History,
  Download,
  Trash2,
  Film,
  Pencil,
} from "lucide-react";

// ============================================================================
// Video generation — Wan (DashScope) + Runway/HeyGen/Pika via task-model
// mapping in AI Settings. Videos generate async (Wan polls 1-3 min), so the
// media library polls status for "processing" rows.
// ============================================================================

const DURATIONS = [
  { label: "5 seconds", value: "5" },
  { label: "10 seconds", value: "10" },
];

const ASPECTS = [
  { label: "Landscape 16:9", value: "1280x720" },
  { label: "Square 1:1", value: "1024x1024" },
  { label: "Portrait 9:16", value: "720x1280" },
];

interface VideoAsset {
  id: string;
  url?: string | null;
  prompt: string;
  status: "processing" | "completed" | "failed";
  provider?: string | null;
  created_at: string;
  metadata?: Record<string, unknown>;
}

interface ModelOption {
  id: string;
  model_identifier: string;
  provider: { id: string; name: string } | null;
}

export default function GenerateVideosPage() {
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState("5");
  const [aspect, setAspect] = useState("1280x720");
  const [models, setModels] = useState<ModelOption[]>([]);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [loading, setLoading] = useState(false);
  const [videos, setVideos] = useState<VideoAsset[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"generate" | "library">("generate");
  const [libraryLoading, setLibraryLoading] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ------------------------------------------------------------------
  // Load video models (from task-model mapping for video_generation)
  // ------------------------------------------------------------------
  const loadModels = useCallback(async () => {
    try {
      const res = await fetch("/api/ai/models?task=video_generation", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setModels(data.models ?? []);
      }
    } catch {
      // ignore — picker stays empty and the API falls back to the mapping
    }
  }, []);

  useEffect(() => {
    loadModels();
  }, [loadModels]);

  // ------------------------------------------------------------------
  // Library: list videos + poll processing ones
  // ------------------------------------------------------------------
  const fetchLibrary = useCallback(async () => {
    try {
      const res = await fetch("/api/media/videos", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setVideos(data.assets ?? []);
        setLibraryLoading(false);
        const stillProcessing = (data.assets ?? []).some(
          (a: VideoAsset) => a.status === "processing"
        );
        // Keep polling while any video is processing.
        if (stillProcessing && !pollRef.current) {
          pollRef.current = setInterval(() => {
            fetch("/api/media/videos", { credentials: "include" })
              .then((r) => r.ok && r.json())
              .then((d) => {
                setVideos(d?.assets ?? []);
                const anyProcessing = (d?.assets ?? []).some(
                  (a: VideoAsset) => a.status === "processing"
                );
                if (!anyProcessing && pollRef.current) {
                  clearInterval(pollRef.current);
                  pollRef.current = null;
                }
              })
              .catch(() => {});
          }, 8000);
        } else if (!stillProcessing && pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }
    } catch {
      setLibraryLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLibrary();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchLibrary]);

  // ------------------------------------------------------------------
  // Generate
  // ------------------------------------------------------------------
  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/media/videos", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          duration: Number(duration),
          resolution: aspect,
          modelId: selectedModelId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to generate video");
        return;
      }
      setActiveTab("library");
      setPrompt("");
      fetchLibrary();
    } catch (err: any) {
      setError(err.message ?? "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  // ------------------------------------------------------------------
  // Download / Reuse / Delete
  // ------------------------------------------------------------------
  const handleDownload = async (url: string) => {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `generated-video-${Date.now()}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch {
      // open raw URL as fallback
      window.open(url, "_blank");
    }
  };

  const handleReuse = (v: VideoAsset) => {
    setPrompt(v.prompt);
    setActiveTab("generate");
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this video from the library?")) return;
    try {
      const res = await fetch(`/api/media-assets/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) {
        setVideos((prev) => prev.filter((v) => v.id !== id));
      }
    } catch {
      // ignore
    }
  };

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Generate Videos</h1>
        <p className="text-muted-foreground mt-1">
          Create AI-generated video clips using your configured video models
          (Alibaba Wan, Runway, HeyGen, Pika). Pick the model in AI Settings →
          Video Generation.
        </p>
      </div>

      {/* Tab Toggle */}
      <div className="flex items-center gap-2 border-b pb-2">
        <button
          onClick={() => setActiveTab("generate")}
          className={`text-sm font-medium px-3 py-1.5 rounded-t-md transition-colors ${
            activeTab === "generate" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Sparkles className="size-3 inline mr-1" /> Generate
        </button>
        <button
          onClick={() => setActiveTab("library")}
          className={`text-sm font-medium px-3 py-1.5 rounded-t-md transition-colors ${
            activeTab === "library" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <History className="size-3 inline mr-1" /> Video Library ({videos.length})
        </button>
      </div>

      {activeTab === "generate" && (
        <>
          <Card className="p-6">
            <div className="space-y-4">
              <div>
                <label htmlFor="vprompt" className="block text-sm font-medium mb-1.5">
                  Video Prompt
                </label>
                <textarea
                  id="vprompt"
                  rows={4}
                  placeholder="A drone shot flying over a Canadian lake at sunset, mist over the water, cinematic lighting..."
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  maxLength={2000}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring resize-y"
                />
                <span className="text-xs text-muted-foreground mt-1 block">
                  {prompt.length}/2000 characters
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label htmlFor="vmodel" className="block text-sm font-medium mb-1.5">
                    Video Model
                  </label>
                  <select
                    id="vmodel"
                    value={selectedModelId}
                    onChange={(e) => setSelectedModelId(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="">Use AI Settings mapping</option>
                    {models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.model_identifier} ({m.provider?.name ?? "provider"})
                      </option>
                    ))}
                  </select>
                  {models.length === 0 && (
                    <p className="text-xs text-muted-foreground mt-1">
                      No models listed — the configured task mapping will be used.
                    </p>
                  )}
                </div>
                <div>
                  <label htmlFor="vdur" className="block text-sm font-medium mb-1.5">
                    Duration
                  </label>
                  <select
                    id="vdur"
                    value={duration}
                    onChange={(e) => setDuration(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    {DURATIONS.map((d) => (
                      <option key={d.value} value={d.value}>{d.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="vaspect" className="block text-sm font-medium mb-1.5">
                    Aspect Ratio
                  </label>
                  <select
                    id="vaspect"
                    value={aspect}
                    onChange={(e) => setAspect(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    {ASPECTS.map((a) => (
                      <option key={a.value} value={a.value}>{a.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {error && (
                <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm">{error}</div>
              )}

              <Button onClick={handleGenerate} disabled={loading || !prompt.trim()} className="w-full sm:w-auto">
                {loading ? (
                  <><Loader2 className="size-4 animate-spin mr-2" />Generating...</>
                ) : (
                  <><Video className="size-4 mr-2" />Generate Video</>
                )}
              </Button>
              <p className="text-xs text-muted-foreground">
                Generation usually takes 1–3 minutes. Your video appears in the
                library below and the page refreshes automatically.
              </p>
            </div>
          </Card>

          {videos.length === 0 && (
            <Card className="p-12 text-center text-muted-foreground">
              <Film className="size-12 mx-auto mb-3 opacity-20" />
              <p className="text-sm">No videos yet.</p>
              <p className="text-xs mt-1">Enter a prompt above and click Generate Video.</p>
            </Card>
          )}
        </>
      )}

      {activeTab === "library" && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Video Library</h2>
          </div>
          {libraryLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : videos.length === 0 ? (
            <Card className="p-12 text-center text-muted-foreground">
              <Film className="size-12 mx-auto mb-3 opacity-20" />
              <p className="text-sm">No videos in this workspace yet.</p>
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {videos.map((v) => (
                <Card key={v.id} className="overflow-hidden">
                  <div className="aspect-video bg-muted relative flex items-center justify-center">
                    {v.status === "completed" && v.url ? (
                      <video
                        src={v.url}
                        controls
                        className="w-full h-full object-contain"
                        preload="metadata"
                      />
                    ) : v.status === "processing" ? (
                      <div className="text-center">
                        <Loader2 className="size-8 animate-spin text-primary mx-auto" />
                        <p className="text-xs text-muted-foreground mt-2">Generating…</p>
                      </div>
                    ) : (
                      <div className="text-center text-sm text-red-500">
                        Generation failed
                        {v.metadata?.error ? (
                          <span className="block text-xs text-muted-foreground mt-1 max-w-sm mx-auto line-clamp-2">
                            {String(v.metadata.error)}
                          </span>
                        ) : null}
                      </div>
                    )}
                  </div>
                  <div className="p-3 space-y-2">
                    <p className="text-xs text-muted-foreground line-clamp-2" title={v.prompt}>
                      {v.prompt}
                    </p>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(v.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </span>
                      <div className="flex gap-1">
                        {v.status === "completed" && v.url && (
                          <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => handleDownload(v.url!)}>
                            <Download className="size-3 mr-1" />Download
                          </Button>
                        )}
                        <button
                          onClick={() => handleReuse(v)}
                          className="p-1.5 rounded hover:bg-blue-100 dark:hover:bg-blue-900 text-blue-600"
                          title="Reuse prompt"
                        >
                          <Pencil className="size-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(v.id)}
                          className="p-1.5 rounded hover:bg-red-100 dark:hover:bg-red-900 text-red-500"
                          title="Delete video"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
