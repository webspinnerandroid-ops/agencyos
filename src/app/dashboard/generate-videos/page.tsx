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
  ImageUp,
  X,
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
  thumbnail_url?: string | null;
  model?: string | null;
  prompt: string;
  status: "processing" | "completed" | "failed";
  provider?: string | null;
  created_at: string;
  metadata?: Record<string, unknown>;
}

/** Short label for a video's generation mode from its metadata. */
function modeLabel(meta?: Record<string, unknown>): string {
  const mode = meta?.mode;
  if (mode === "i2v") return "Image → Video";
  if (mode === "t2v") return "Text → Video";
  // Fall back to inferring from the model id.
  const model = String(meta?.modelIdentifier ?? "");
  if (model.includes("i2v") || model.includes("image-to-video")) return "Image → Video";
  return "Text → Video";
}

/** mm:ss (or h:mm:ss) from seconds. */
function formatDuration(seconds?: number): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null;
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/** Human-readable file size from bytes. */
function formatSize(bytes?: number): string | null {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return null;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
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
  // Generation mode drives the model picker: choosing Image→Video
  // auto-selects an i2v model, Text→Video auto-selects a t2v model.
  const [mode, setMode] = useState<"t2v" | "i2v">("t2v");
  const [referenceImage, setReferenceImage] = useState<string | null>(null);
  const [referenceUploading, setReferenceUploading] = useState(false);
  const [referenceError, setReferenceError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const [enhanceError, setEnhanceError] = useState<string | null>(null);
  const [videos, setVideos] = useState<VideoAsset[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"generate" | "library">("generate");
  const [libraryLoading, setLibraryLoading] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Poster capture in flight per asset id (manual button spinner).
  const [capturing, setCapturing] = useState<Record<string, boolean>>({});
  // Duration + file size badges per asset id.
  const [videoInfo, setVideoInfo] = useState<
    Record<string, { duration?: number; sizeBytes?: number }>
  >({});

  // ------------------------------------------------------------------
  // Load video models (from task-model mapping for video_generation)
  // ------------------------------------------------------------------
  const isI2VModel = (id: string) =>
    id.includes("i2v") || id.includes("image-to-video");

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

  // Auto-select the first model matching the current mode (t2v vs i2v).
  useEffect(() => {
    if (models.length === 0) return;
    const matches = models.filter((m) =>
      mode === "i2v" ? isI2VModel(m.model_identifier) : !isI2VModel(m.model_identifier)
    );
    if (matches.length > 0) {
      setSelectedModelId(matches[0].id);
    }
  }, [models, mode]);

  // Switching mode flips the auto-pick above; picking a model manually also
  // syncs the mode so the two never disagree.
  const handleModeChange = (next: "t2v" | "i2v") => {
    setMode(next);
  };

  const handleModelChange = (id: string) => {
    setSelectedModelId(id);
    const m = models.find((x) => x.id === id);
    if (m) setMode(isI2VModel(m.model_identifier) ? "i2v" : "t2v");
  };

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
  // Reference image upload (image-to-video models need a public URL)
  // ------------------------------------------------------------------
  const selectedModel = models.find((m) => m.id === selectedModelId);
  const isI2V = mode === "i2v";

  const handleReferenceFile = async (file: File | undefined | null) => {
    setReferenceError(null);
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setReferenceError("Please select an image file (PNG, JPG, WEBP).");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setReferenceError("Image must be 10MB or smaller.");
      return;
    }
    setReferenceUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/cms/upload", {
        method: "POST",
        credentials: "include",
        body: form,
      });
      const data = await res.json();
      if (!res.ok || !data.url) {
        setReferenceError(data.error ?? "Upload failed");
        return;
      }
      setReferenceImage(data.url);
    } catch (err: any) {
      setReferenceError(err?.message ?? "Upload failed");
    } finally {
      setReferenceUploading(false);
    }
  };

  // ------------------------------------------------------------------
  // Generate
  // ------------------------------------------------------------------
  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    if (isI2V && !referenceImage) {
      setError("This model is image-to-video — upload a reference image first.");
      return;
    }
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
          modelIdentifier: selectedModel?.model_identifier ?? undefined,
          mode,
          imageUrl: referenceImage ?? undefined,
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
  // Enhance prompt (mirrors the image generator)
  // ------------------------------------------------------------------
  const handleEnhancePrompt = async () => {
    if (!prompt.trim()) return;
    setEnhancing(true);
    setEnhanceError(null);
    try {
      const res = await fetch("/api/generate-video/enhance-prompt", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setEnhanceError(data.error ?? "Failed to enhance prompt");
        return;
      }
      if (data.enhancedPrompt) setPrompt(data.enhancedPrompt);
    } catch (err: any) {
      setEnhanceError(err.message ?? "Failed to enhance prompt");
    } finally {
      setEnhancing(false);
    }
  };

  // ------------------------------------------------------------------
  // Open / Reuse / Delete
  // ------------------------------------------------------------------
  // Opens the video in a new tab where the visitor can watch it and save
  // it via the browser's own controls (this is CDN-served, so a direct
  // download link is more reliable than a fetch-and-blob dance).
  const handleOpen = (url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const handleReuse = (v: VideoAsset) => {
    setPrompt(v.prompt);
    // Restore the same mode + model the video was generated with.
    const meta = v.metadata ?? {};
    const wasI2V =
      meta.mode === "i2v" ||
      String(meta.modelIdentifier ?? "").includes("i2v") ||
      String(meta.modelIdentifier ?? "").includes("image-to-video");
    setMode(wasI2V ? "i2v" : "t2v");
    if (meta.modelIdentifier) {
      const m = models.find((x) => x.model_identifier === meta.modelIdentifier);
      if (m) setSelectedModelId(m.id);
    }
    setActiveTab("generate");
  };

  // Captures a poster frame from a completed video: seeks to ~0.4s, draws to
  // canvas, uploads the data URL, and refreshes the library. Runs automatically
  // for videos missing a thumbnail, and on demand via the capture button.
  const capturingRef = useRef<Set<string>>(new Set());
  const capturePoster = async (v: VideoAsset, opts?: { force?: boolean }) => {
    if (!v.url || v.status !== "completed") return;
    if (!opts?.force && v.thumbnail_url) return;
    if (capturingRef.current.has(v.id)) return;
    capturingRef.current.add(v.id);
    setCapturing((prev) => ({ ...prev, [v.id]: true }));
    try {
      const video = document.createElement("video");
      video.src = v.url;
      video.muted = true;
      video.crossOrigin = "anonymous";
      await new Promise<void>((resolve) => {
        video.onloadeddata = () => resolve();
        video.onerror = () => resolve();
        setTimeout(resolve, 8000);
        video.load();
      });
      if (!video.videoWidth) return;
      video.currentTime = Math.min(0.4, (video.duration || 0.4) / 2);
      await new Promise<void>((resolve) => {
        video.onseeked = () => resolve();
        setTimeout(resolve, 4000);
      });
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
      const res = await fetch(`/api/media/videos/${v.id}/thumbnail`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: dataUrl }),
      });
      if (res.ok) fetchLibrary();
    } catch {
      // poster is a nice-to-have — never break the library over it
    } finally {
      capturingRef.current.delete(v.id);
      setCapturing((prev) => ({ ...prev, [v.id]: false }));
    }
  };

  // Reads a video's duration + file size (HEAD on the CDN URL) so the card
  // can show badges. Cached per asset id.
  const readVideoInfo = async (v: VideoAsset) => {
    if (!v.url || v.status !== "completed") return;
    if (videoInfo[v.id]) return;
    const info: { duration?: number; sizeBytes?: number } = {};
    try {
      const res = await fetch(v.url, { method: "HEAD", credentials: "omit" });
      const len = Number(res.headers.get("content-length"));
      if (Number.isFinite(len) && len > 0) info.sizeBytes = len;
    } catch {
      // ignore
    }
    try {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.src = v.url;
      await new Promise<void>((resolve) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => resolve();
        setTimeout(resolve, 6000);
        video.load();
      });
      if (Number.isFinite(video.duration) && video.duration > 0) {
        info.duration = video.duration;
      }
    } catch {
      // ignore
    }
    if (info.duration != null || info.sizeBytes != null) {
      setVideoInfo((prev) => ({ ...prev, [v.id]: info }));
    }
  };

  // Kick off poster capture for any completed video missing a thumbnail, and
  // read size/duration badges for completed videos.
  useEffect(() => {
    (videos ?? []).forEach((v) => {
      if (v.status === "completed" && v.url) {
        if (!v.thumbnail_url) void capturePoster(v);
        void readVideoInfo(v);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videos]);

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
                <div className="flex gap-2">
                  <textarea
                    id="vprompt"
                    rows={4}
                    placeholder="A drone shot flying over a Canadian lake at sunset, mist over the water, cinematic lighting..."
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    maxLength={2000}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring resize-y"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleEnhancePrompt}
                    disabled={enhancing || !prompt.trim()}
                    title="Expand this into a detailed, professional prompt"
                    className="shrink-0 self-start"
                  >
                    {enhancing ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                    <span className="hidden sm:inline ml-1">Enhance</span>
                  </Button>
                </div>
                {enhanceError && (
                  <p className="text-xs text-destructive mt-1">{enhanceError}</p>
                )}
                <span className="text-xs text-muted-foreground mt-1 block">
                  {prompt.length}/2000 characters
                </span>
              </div>

              <div className="space-y-4">
                {/* Generation mode — auto-selects the matching model */}
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    Generation Mode
                  </label>
                  <div className="grid grid-cols-2 gap-2 max-w-xs">
                    <button
                      type="button"
                      onClick={() => handleModeChange("t2v")}
                      className={`rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                        mode === "t2v"
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-input text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      Text → Video
                    </button>
                    <button
                      type="button"
                      onClick={() => handleModeChange("i2v")}
                      className={`rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                        mode === "i2v"
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-input text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      Image → Video
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {mode === "i2v"
                      ? "Image-to-video — animate a reference image. A compatible model is selected automatically."
                      : "Text-to-video — generate from a prompt alone. A compatible model is selected automatically."}
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label htmlFor="vmodel" className="block text-sm font-medium mb-1.5">
                    Video Model
                  </label>
                  <select
                    id="vmodel"
                    value={selectedModelId}
                    onChange={(e) => handleModelChange(e.target.value)}
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
                {isI2V && (
                  <div>
                    <label className="block text-sm font-medium mb-1.5">
                      Reference Image (required for image-to-video)
                    </label>
                    <div className="flex flex-wrap items-center gap-3">
                      {referenceImage ? (
                        <div className="relative">
                          <img
                            src={referenceImage}
                            alt="Reference"
                            className="h-20 w-20 object-cover rounded-md border"
                          />
                          <button
                            onClick={() => setReferenceImage(null)}
                            className="absolute -top-2 -right-2 p-0.5 rounded-full bg-red-500 text-white hover:bg-red-600"
                            title="Remove reference image"
                          >
                            <X className="size-3" />
                          </button>
                        </div>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={referenceUploading}
                        >
                          {referenceUploading ? (
                            <Loader2 className="size-3.5 animate-spin mr-1" />
                          ) : (
                            <ImageUp className="size-3.5 mr-1" />
                          )}
                          Upload Image
                        </Button>
                      )}
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => handleReferenceFile(e.target.files?.[0])}
                      />
                    </div>
                    {referenceError && (
                      <p className="text-xs text-destructive mt-1">{referenceError}</p>
                    )}
                  </div>
                )}
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
          ) : (                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {videos.map((v) => (
                <Card key={v.id} className="overflow-hidden">
                  <div className="aspect-video bg-muted relative flex items-center justify-center">
                    {v.status === "completed" && v.url ? (
                      <video
                        src={v.url}
                        poster={v.thumbnail_url ?? undefined}
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
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                        {modeLabel(v.metadata)}
                      </span>
                      {v.metadata?.modelIdentifier ? (
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-mono truncate max-w-[220px]"
                          title={String(v.metadata.modelIdentifier)}
                        >
                          {String(v.metadata.modelIdentifier)}
                        </span>
                      ) : v.model ? (
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-mono truncate max-w-[220px]"
                          title={v.model}
                        >
                          {v.model}
                        </span>
                      ) : null}
                      {videoInfo[v.id]?.duration != null && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                          {formatDuration(videoInfo[v.id].duration)}
                        </span>
                      )}
                      {videoInfo[v.id]?.sizeBytes != null && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                          {formatSize(videoInfo[v.id].sizeBytes)}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2" title={v.prompt}>
                      {v.prompt}
                    </p>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(v.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </span>
                      <div className="flex gap-1">
                        {v.status === "completed" && v.url && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-xs h-7"
                            onClick={() => handleOpen(v.url!)}
                            title="Opens the video in a new tab to watch or save"
                          >
                            <Download className="size-3 mr-1" />Open / Download
                          </Button>
                        )}
                        {v.status === "completed" && v.url && (
                          <button
                            onClick={() => capturePoster(v, { force: true })}
                            className="p-1.5 rounded hover:bg-amber-100 dark:hover:bg-amber-900 text-amber-600"
                            title="Capture a new poster frame"
                            disabled={!!capturing[v.id]}
                          >
                            {capturing[v.id] ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                              <ImageUp className="size-3.5" />
                            )}
                          </button>
                        )}
                        <button
                          onClick={() => handleReuse(v)}
                          className="p-1.5 rounded hover:bg-blue-100 dark:hover:bg-blue-900 text-blue-600"
                          title="Reuse prompt, mode, and model"
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
