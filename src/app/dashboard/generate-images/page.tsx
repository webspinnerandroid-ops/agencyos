"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Loader2, Download, ImagePlus, Sparkles, Trash2, History, Pencil, Wand2, ImageUp, X, Copy, FolderInput } from "lucide-react";
import { getWorkspaces, type Workspace } from "@/lib/workspace";

const SIZES = [
  { label: "Square (1024×1024)", value: "1024x1024" },
  { label: "Landscape (1792×1024)", value: "1792x1024" },
  { label: "Portrait (1024×1792)", value: "1024x1792" },
  { label: "Small (512×512)", value: "512x512" },
];

const LOCAL_STORAGE_KEY = "agency_os_recent_images";

interface GeneratedImage {
  url: string;
  revisedPrompt: string | null;
}

interface MediaAsset {
  id: string;
  url: string;
  prompt: string;
  created_at: string;
  metadata?: { size?: string; revisedPrompt?: string };
  source?: "database" | "localStorage";
}

export default function GenerateImagesPage() {
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState("1024x1024");
  const [n, setN] = useState(1);
  const [loading, setLoading] = useState(false);
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [recentImages, setRecentImages] = useState<MediaAsset[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(true);
  const [recentError, setRecentError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"generate" | "recent">("generate");
  const [enhancingPrompt, setEnhancingPrompt] = useState(false);
  const [enhanceError, setEnhanceError] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<{ url: string; prompt: string } | null>(null);
  const [referenceImage, setReferenceImage] = useState<string | null>(null);
  const [referenceError, setReferenceError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // ------------------------------------------------------------------
  // localStorage helpers
  // ------------------------------------------------------------------
  const loadLocalImages = useCallback((): MediaAsset[] => {
    try {
      const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (!stored) return [];
      const parsed = JSON.parse(stored);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, []);

  const saveLocalImages = useCallback((assets: MediaAsset[]) => {
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(assets));
    } catch { /* quota exceeded — ignore */ }
  }, []);

  const addToLocalStorage = useCallback((imgs: GeneratedImage[], promptText: string) => {
    const existing = loadLocalImages();
    const now = new Date().toISOString();
    const newAssets: MediaAsset[] = imgs.map((img, i) => ({
      id: `local-${Date.now()}-${i}`,
      url: img.url,
      prompt: promptText,
      created_at: now,
      metadata: { size, revisedPrompt: img.revisedPrompt ?? undefined },
      source: "localStorage" as const,
    }));
    const merged = [...newAssets, ...existing].slice(0, 50);
    saveLocalImages(merged);
    return merged;
  }, [loadLocalImages, saveLocalImages, size]);

  // ------------------------------------------------------------------
  // Delete a single image from localStorage
  // ------------------------------------------------------------------
  const handleDelete = useCallback((assetId: string) => {
    const updated = loadLocalImages().filter((a) => a.id !== assetId);
    saveLocalImages(updated);
    setImages((prev) => prev.filter((_, i) => `local-${Date.now()}-${i}` !== assetId));
    setRecentImages((prev) => prev.filter((a) => a.id !== assetId));
  }, [loadLocalImages, saveLocalImages]);

  // ------------------------------------------------------------------
  // Delete a result image (from current session)
  // ------------------------------------------------------------------
  const handleDeleteResult = useCallback((index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // ------------------------------------------------------------------
  // Clear all recent images
  // ------------------------------------------------------------------
  const handleClearAll = useCallback(() => {
    if (!confirm("Delete all 50 recent images? This cannot be undone.")) return;
    saveLocalImages([]);
    setRecentImages([]);
    setImages([]);
  }, [saveLocalImages]);

  // ------------------------------------------------------------------
  // Edit / Refine — fills prompt with original text, switches to Generate tab
  // ------------------------------------------------------------------
  const handleEdit = useCallback((asset: MediaAsset) => {
    setPrompt(asset.prompt);
    setActiveTab("generate");
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // ------------------------------------------------------------------
  // Reference / inspiration image upload
  // ------------------------------------------------------------------
  const handleReferenceFile = useCallback((file: File | undefined | null) => {
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
    reader.onload = () => {
      setReferenceImage(reader.result as string);
    };
    reader.onerror = () => {
      setReferenceError("Failed to read the image file.");
    };
    reader.readAsDataURL(file);
  }, []);

  // ------------------------------------------------------------------
  // Fetch recent images from server + localStorage
  // ------------------------------------------------------------------
  const fetchRecentImages = useCallback(async () => {
    const localImages = loadLocalImages().map((a: MediaAsset) => ({ ...a, source: "localStorage" as const }));
    try {
      const res = await fetch("/api/generate-image/recent", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        const serverImages: MediaAsset[] = (data.assets ?? []).map((a: MediaAsset) => ({
          ...a,
          source: "database" as const,
        }));
        // Dedupe by URL: server image wins, skip localStorage image with same URL
        const serverUrls = new Set(serverImages.map((a: MediaAsset) => a.url));
        const uniqueLocal = localImages.filter((a: MediaAsset) => !serverUrls.has(a.url));
        setRecentImages([...serverImages, ...uniqueLocal]);
        setRecentError(null);
        return;
      }
    } catch {
      // Server unreachable — use localStorage only
    }
    setRecentImages(localImages);
    if (localImages.length === 0) {
      setRecentError(null);
    }
  }, [loadLocalImages]);

  useEffect(() => {
    fetchRecentImages().finally(() => setLoadingRecent(false));
  }, [fetchRecentImages]);

  // ------------------------------------------------------------------
  // Generate
  // ------------------------------------------------------------------
  const handleGenerate = async () => {
    if (!prompt.trim()) return;

    setLoading(true);
    setError(null);
    setImages([]);

    try {
      const res = await fetch("/api/generate-image", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim(), size, n, referenceImage: referenceImage ?? undefined }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Failed to generate images");
        return;
      }

      if (data.images) {
        setImages(data.images);
        addToLocalStorage(data.images, prompt.trim());
        fetchRecentImages();
      }
    } catch (err: any) {
      setError(err.message ?? "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  // ------------------------------------------------------------------
  // Enhance prompt with DeepSeek
  // ------------------------------------------------------------------
  const handleEnhancePrompt = async () => {
    if (!prompt.trim()) return;
    setEnhancingPrompt(true);
    setEnhanceError(null);
    try {
      const res = await fetch("/api/generate-image/enhance-prompt", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setEnhanceError(data.error ?? data.details ?? "Failed to enhance prompt");
        return;
      }
      if (data.enhancedPrompt) {
        setPrompt(data.enhancedPrompt);
      }
    } catch (err: any) {
      setEnhanceError(err.message ?? "Failed to enhance prompt");
    } finally {
      setEnhancingPrompt(false);
    }
  };

  // ------------------------------------------------------------------
  // Download / Copy
  // ------------------------------------------------------------------
  const handleDownload = async (url: string, index: number) => {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `generated-image-${index + 1}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch {
      // Raw-URL tab shows only part of portrait images; use the lightbox instead.
    }
  };

  // ------------------------------------------------------------------
  // Move / Copy image between workspaces (server-stored images only)
  // ------------------------------------------------------------------
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [moveTarget, setMoveTarget] = useState<Record<string, string>>({});

  const loadWorkspaces = useCallback(async () => {
    const res = await getWorkspaces();
    if (res.success && res.data) setWorkspaces(res.data);
  }, []);

  useEffect(() => {
    loadWorkspaces();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleMoveAsset = async (asset: MediaAsset, targetWs: string, mode: "move" | "copy") => {
    if (!asset.id || !targetWs) return;
    try {
      const endpoint = mode === "move"
        ? `/api/media-assets/${asset.id}`
        : `/api/media-assets/${asset.id}/duplicate`;
      const res = await fetch(endpoint, {
        method: mode === "move" ? "PATCH" : "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: targetWs }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error ?? "Failed to " + mode + " image");
        return;
      }
      setMoveTarget((prev) => ({ ...prev, [asset.id]: "" }));
      if (mode === "move") {
        // Remove from current list after moving
        setRecentImages((prev) => prev.filter((a) => a.id !== asset.id));
      }
      fetchRecentImages();
    } catch (err: any) {
      alert(err?.message ?? "Failed to " + mode + " image");
    }
  };

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8" ref={scrollRef}>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Generate Images</h1>
        <p className="text-muted-foreground mt-1">
          Create AI-generated images using your configured providers (DALL-E, Stability AI, Google Imagen).
        </p>
      </div>

      {/* Tab Toggle */}
      <div className="flex items-center gap-2 border-b pb-2">
        <button onClick={() => setActiveTab("generate")}
          className={`text-sm font-medium px-3 py-1.5 rounded-t-md transition-colors ${activeTab === "generate" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
          <Sparkles className="size-3 inline mr-1" /> Generate
        </button>
        <button onClick={() => setActiveTab("recent")}
          className={`text-sm font-medium px-3 py-1.5 rounded-t-md transition-colors ${activeTab === "recent" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
          <History className="size-3 inline mr-1" /> Recent Images ({recentImages.length})
        </button>
      </div>

      {activeTab === "generate" && (
        <>
          {/* Input Form */}
          <Card className="p-6">
            <div className="space-y-4">
              <div>
                <label htmlFor="prompt" className="block text-sm font-medium mb-1.5">
                  Image Prompt
                </label>
                <textarea
                  id="prompt"
                  rows={4}
                  placeholder="A photorealistic image of a modern office space with natural lighting..."
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  maxLength={4000}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring resize-y"
                />
                <span className="text-xs text-muted-foreground mt-1 block">
                  {prompt.length}/4000 characters
                </span>
              </div>

              {/* Reference / Inspiration Image Upload */}
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  Inspiration Image (optional)
                </label>
                <div className="flex flex-wrap items-center gap-3">
                  {referenceImage ? (
                    <div className="relative">
                      <img src={referenceImage} alt="Inspiration" className="h-20 w-20 object-cover rounded-md border" />
                      <button
                        onClick={() => setReferenceImage(null)}
                        className="absolute -top-2 -right-2 p-0.5 rounded-full bg-red-500 text-white hover:bg-red-600"
                        title="Remove inspiration image"
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
                    >
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
                  <span className="text-xs text-muted-foreground">
                    Upload a reference image (max 5MB) for style/composition inspiration. Used with Google Imagen.
                  </span>
                </div>
                {referenceError && (
                  <div className="mt-2 p-2 rounded-md bg-destructive/10 text-destructive text-xs">{referenceError}</div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="size" className="block text-sm font-medium mb-1.5">Size</label>
                  <select id="size" value={size} onChange={(e) => setSize(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                    {SIZES.map((s) => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="n" className="block text-sm font-medium mb-1.5">Number of Images</label>
                  <select id="n" value={n} onChange={(e) => setN(Number(e.target.value))}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                    {[1, 2, 3, 4].map((num) => (
                      <option key={num} value={num}>{num}</option>
                    ))}
                  </select>
                </div>
              </div>

              {error && (
                <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm">{error}</div>
              )}

              {enhanceError && (
                <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm">{enhanceError}</div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={handleGenerate} disabled={loading || !prompt.trim()} className="w-full sm:w-auto">
                  {loading ? <><Loader2 className="size-4 animate-spin mr-2" />Generating...</> : <><Sparkles className="size-4 mr-2" />Generate</>}
                </Button>
                <Button
                  variant="secondary"
                  onClick={handleEnhancePrompt}
                  disabled={enhancingPrompt || !prompt.trim()}
                  className="w-full sm:w-auto"
                  title="Use DeepSeek AI to expand your prompt into a detailed, professional image prompt"
                >
                  {enhancingPrompt ? <><Loader2 className="size-4 animate-spin mr-2" />Enhancing...</> : <><Wand2 className="size-4 mr-2" />Enhance Prompt (AI)</>}
                </Button>
              </div>
            </div>
          </Card>

          {/* Results */}
          {images.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">Results</h2>
                <Button variant="ghost" size="sm" className="text-xs text-muted-foreground hover:text-destructive" onClick={() => setImages([])}>
                  <Trash2 className="size-3 mr-1" /> Clear All
                </Button>
              </div>
              <div className={`grid gap-4 ${images.length === 1 ? "grid-cols-1 max-w-2xl" : "grid-cols-1 sm:grid-cols-2"}`}>
                {images.map((img, i) => (
                  <Card key={i} className="overflow-hidden">
                    <div className="aspect-square bg-muted relative group">
                      <img src={img.url} alt={img.revisedPrompt ?? `Generated image ${i + 1}`}
                        className="w-full h-full object-cover cursor-zoom-in"
                        onClick={() => setPreviewImage({ url: img.url, prompt: img.revisedPrompt ?? prompt })}
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100 pointer-events-none">
                        <button onClick={() => handleDownload(img.url, i)} className="pointer-events-auto p-2 rounded-lg bg-white/90 text-black hover:bg-white" title="Download"><Download className="size-4" /></button>
                      </div>
                      {/* Delete result button */}
                      <button
                        onClick={() => handleDeleteResult(i)}
                        className="absolute top-2 right-2 p-1.5 rounded-lg bg-red-500/80 text-white hover:bg-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Remove"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                    <div className="p-3 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground font-medium">Image {i + 1} of {images.length}</span>
                        <span className="text-xs text-muted-foreground">{size}</span>
                      </div>
                      {img.revisedPrompt && <p className="text-xs text-muted-foreground line-clamp-2 italic">{img.revisedPrompt}</p>}
                      <div className="flex gap-2 pt-1">
                        <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => handleDownload(img.url, i)}><Download className="size-3 mr-1" />Download</Button>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {images.length === 0 && !loading && (
            <Card className="p-12 text-center text-muted-foreground">
              <ImagePlus className="size-12 mx-auto mb-3 opacity-20" />
              <p className="text-sm">No images generated yet.</p>
              <p className="text-xs mt-1">Enter a prompt above and click Generate to create images.</p>
            </Card>
          )}
        </>
      )}

      {/* Lightbox / Zoom Modal */}
      {previewImage && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setPreviewImage(null)}
        >
          <div className="relative max-w-[95vw] max-h-[95vh] flex flex-col items-center" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setPreviewImage(null)}
              className="absolute -top-10 right-0 text-white/70 hover:text-white text-sm px-2 py-1"
            >
              ✕ Close
            </button>
            <img
              src={previewImage.url}
              alt={previewImage.prompt}
              className="max-w-[95vw] max-h-[85vh] object-contain rounded-lg"
            />
            <p className="text-white/80 text-xs mt-3 max-w-2xl text-center line-clamp-3">
              {previewImage.prompt}
            </p>
            <div className="flex gap-3 mt-4">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => handleDownload(previewImage.url, 0)}
              >
                <Download className="size-3.5 mr-1" /> Download
              </Button>
                          </div>
          </div>
        </div>
      )}

      {/* Recent Images Tab */}
      {activeTab === "recent" && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Recent Images</h2>
            {recentImages.length > 0 && (
              <Button variant="ghost" size="sm" className="text-xs text-muted-foreground hover:text-destructive" onClick={handleClearAll}>
                <Trash2 className="size-3 mr-1" /> Clear All Recent
              </Button>
            )}
          </div>
          {loadingRecent ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : recentImages.length === 0 ? (
            <Card className="p-12 text-center text-muted-foreground">
              <History className="size-12 mx-auto mb-3 opacity-20" />
              <p className="text-sm">No recent images found.</p>
              <p className="text-xs mt-1">Generate some images and they will appear here.</p>
            </Card>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {recentImages.map((asset) => (
                <Card key={asset.id} className="overflow-hidden group/card">
                  <div className="aspect-square bg-muted relative group">
                    <img src={asset.url} alt={asset.prompt}
                      className="w-full h-full object-cover cursor-zoom-in"
                      onClick={() => setPreviewImage({ url: asset.url, prompt: asset.prompt })}
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    {/* Hover actions */}
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100 pointer-events-none">
                      <button onClick={() => handleDownload(asset.url, 0)} className="pointer-events-auto p-2 rounded-lg bg-white/90 text-black hover:bg-white" title="Download"><Download className="size-4" /></button>
                    </div>
                    {/* Edit button (top-left) */}
                    <button
                      onClick={() => handleEdit(asset)}
                      className="absolute top-2 left-2 p-1.5 rounded-lg bg-blue-500/80 text-white hover:bg-blue-600 opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Edit prompt"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    {/* Delete button (top-right) */}
                    <button
                      onClick={() => handleDelete(asset.id)}
                      className="absolute top-2 right-2 p-1.5 rounded-lg bg-red-500/80 text-white hover:bg-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Delete"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                    {/* Source badge */}
                    <span className="absolute bottom-2 left-2 px-1.5 py-0.5 rounded text-[9px] font-medium bg-black/60 text-white">
                      {asset.source === "database" ? "☁ Server" : "💻 Local"}
                    </span>
                  </div>
                  <div className="p-2.5">
                    <p className="text-xs text-muted-foreground line-clamp-2" title={asset.prompt}>{asset.prompt}</p>
                    <div className="flex items-center justify-between mt-1">
                      <p className="text-[10px] text-muted-foreground">
                        {new Date(asset.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </p>
                      <div className="flex gap-1 opacity-0 group-hover/card:opacity-100 transition-opacity">
                        <button onClick={() => handleEdit(asset)}
                          className="p-1 rounded hover:bg-blue-100 dark:hover:bg-blue-900 text-blue-600"
                          title="Refine prompt">
                          <Pencil className="size-3" />
                        </button>
                        <button onClick={() => handleDelete(asset.id)}
                          className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900 text-red-500"
                          title="Delete image">
                          <Trash2 className="size-3" />
                        </button>
                      </div>
                    </div>
                    {asset.source === "database" && workspaces.length > 1 && (
                      <div className="mt-2 flex items-center gap-1">
                        <select
                          value={moveTarget[asset.id] ?? ""}
                          onChange={(e) => setMoveTarget((prev) => ({ ...prev, [asset.id]: e.target.value }))}
                          className="w-full rounded border border-input bg-background px-1.5 py-1 text-[10px]"
                        >
                          <option value="">Move to workspace...</option>
                          {workspaces.map((w) => (
                            <option key={w.id} value={w.id}>{w.name}</option>
                          ))}
                        </select>
                        <button
                          onClick={() => handleMoveAsset(asset, moveTarget[asset.id] ?? "", "move")}
                          disabled={!moveTarget[asset.id]}
                          className="p-1 rounded hover:bg-purple-100 dark:hover:bg-purple-900 text-purple-600 disabled:opacity-40"
                          title="Move image to selected workspace"
                        >
                          <FolderInput className="size-3" />
                        </button>
                        <button
                          onClick={() => handleMoveAsset(asset, moveTarget[asset.id] ?? "", "copy")}
                          disabled={!moveTarget[asset.id]}
                          className="p-1 rounded hover:bg-amber-100 dark:hover:bg-amber-900 text-amber-600 disabled:opacity-40"
                          title="Copy image to selected workspace"
                        >
                          <Copy className="size-3" />
                        </button>
                      </div>
                    )}
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