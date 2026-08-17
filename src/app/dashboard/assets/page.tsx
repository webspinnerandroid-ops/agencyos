"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  FolderOpen,
  FolderPlus,
  Image as ImageIcon,
  Film,
  Palette,
  AudioLines,
  Search,
  Trash2,
  Pencil,
  Download,
  FolderInput,
  X,
  Check,
  Wand2,
} from "lucide-react";

interface Asset {
  id: string;
  type: "image" | "video" | "voice";
  task?: string | null;
  prompt: string;
  url?: string | null;
  thumbnail_url?: string | null;
  folder_id?: string | null;
  metadata?: Record<string, unknown> | null;
  status: string;
  created_at: string;
}

interface Folder {
  id: string;
  name: string;
  kind: string;
  created_at: string;
}

type Kind = "image" | "brand" | "video" | "voice";

const KIND_TABS: { kind: Kind; label: string; icon: typeof ImageIcon }[] = [
  { kind: "image", label: "Images", icon: ImageIcon },
  { kind: "brand", label: "Brand Design", icon: Palette },
  { kind: "video", label: "Videos", icon: Film },
  { kind: "voice", label: "Voice", icon: AudioLines },
];

function assetTypeForKind(kind: Kind): "image" | "video" | "voice" {
  return kind === "video" ? "video" : kind === "voice" ? "voice" : "image";
}

export default function AssetsPage() {
  const [kind, setKind] = useState<Kind>("image");
  const [folders, setFolders] = useState<Folder[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [unfiled, setUnfiled] = useState(false);

  // Folder editor state
  const [newFolderName, setNewFolderName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renamingName, setRenamingName] = useState("");
  const [moveTarget, setMoveTarget] = useState<Record<string, string>>({});

  const loadFolders = useCallback(async () => {
    try {
      const res = await fetch("/api/assets/folders", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setFolders((data.folders ?? []).filter((f: Folder) => f.kind !== "content"));
      }
    } catch {
      // folders optional
    }
  }, []);

  const loadAssets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("type", assetTypeForKind(kind));
      if (kind === "brand") params.set("task", "brand_design");
      if (selectedFolder) params.set("folderId", selectedFolder);
      if (unfiled) params.set("unfiled", "1");
      if (q.trim()) params.set("q", q.trim());
      params.set("limit", "60");

      const res = await fetch(`/api/assets?${params.toString()}`, { credentials: "include" });
      const data = await res.json();
      if (!res.ok) {
        // asset_folders / task columns may not exist yet if migration 078
        // hasn't run — degrade gracefully to the plain list.
        setError(data.error ?? "Failed to load assets");
        setAssets([]);
        return;
      }
      setAssets(data.assets ?? []);
      setTotal(data.total ?? 0);
    } catch (err: any) {
      setError(err?.message ?? "Failed to load assets");
    } finally {
      setLoading(false);
    }
  }, [kind, selectedFolder, unfiled, q]);

  useEffect(() => {
    loadFolders();
  }, [loadFolders]);

  useEffect(() => {
    loadAssets();
  }, [loadAssets]);

  useEffect(() => {
    // When switching tabs, reset folder selection to avoid cross-kind confusion.
    setSelectedFolder(null);
    setUnfiled(false);
  }, [kind]);

  const createFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    const res = await fetch("/api/assets/folders", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, kind: assetTypeForKind(kind) }),
    });
    if (res.ok) {
      setNewFolderName("");
      await loadFolders();
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Failed to create folder");
    }
  };

  const renameFolder = async (id: string) => {
    const name = renamingName.trim();
    if (!name) return;
    const res = await fetch(`/api/assets/folders/${id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (res.ok) {
      setRenamingId(null);
      await loadFolders();
    }
  };

  const deleteFolder = async (id: string) => {
    if (!confirm("Delete this folder? Its assets will be kept (unfiled).")) return;
    const res = await fetch(`/api/assets/folders/${id}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (res.ok) {
      if (selectedFolder === id) setSelectedFolder(null);
      await loadFolders();
      await loadAssets();
    }
  };

  const moveAsset = async (asset: Asset, folderId: string) => {
    const res = await fetch(`/api/media-assets/${asset.id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderId }),
    });
    if (res.ok) {
      setMoveTarget((prev) => ({ ...prev, [asset.id]: "" }));
      await loadAssets();
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Failed to move asset");
    }
  };

  // Pick the folder whose name best matches this asset's prompt (or a known
  // deliverable keyword) so one click files the asset instead of a manual
  // select+apply dance. Returns null when nothing matches.
  const suggestFolder = (prompt: string, list: Folder[]): Folder | null => {
    const p = (prompt || "").toLowerCase();
    const words = new Set(p.split(/[^a-z0-9]+/).filter((w) => w.length > 2));
    const KEYWORD_MAP: Record<string, string> = {
      logo: "logo",
      icon: "icon",
      "brand mark": "logo",
      mockup: "mockup",
      website: "mockup",
      ui: "mockup",
      social: "social",
      instagram: "social",
      packaging: "packaging",
      label: "packaging",
      guideline: "guidelines",
      "brand book": "guidelines",
      banner: "social",
      ad: "social",
      flyer: "print",
      poster: "print",
      brochure: "print",
      business: "print",
      card: "print",
      video: "video",
      thumbnail: "video",
    };
    let best: Folder | null = null;
    let bestScore = 0;
    for (const f of list) {
      const name = f.name.toLowerCase();
      let score = 0;
      if (name && p.includes(name)) {
        score = 100 + name.length;
      } else {
        for (const w of name.split(/[^a-z0-9]+/)) {
          if (w.length > 2 && words.has(w)) score += 10 + w.length;
        }
      }
      const keyword = Object.entries(KEYWORD_MAP).find(([k]) => p.includes(k));
      if (keyword && name.includes(keyword[1])) score += 20;
      if (score > bestScore) {
        bestScore = score;
        best = f;
      }
    }
    return bestScore > 0 ? best : null;
  };

  const autoFile = async (asset: Asset) => {
    const target = suggestFolder(asset.prompt, foldersForKind);
    if (!target) {
      setError("No matching folder yet — create one (or a folder named after the deliverable) first.");
      return;
    }
    await moveAsset(asset, target.id);
  };

  const onDragStart = (e: React.DragEvent, assetId: string) => {
    e.dataTransfer.setData("text/plain", assetId);
    e.dataTransfer.effectAllowed = "move";
  };

  const onDropOnFolder = async (e: React.DragEvent, folderId: string) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain");
    if (!id) return;
    const asset = assets.find((a) => a.id === id);
    if (!asset) return;
    await moveAsset(asset, folderId);
  };

  const deleteAsset = async (asset: Asset) => {
    if (!confirm("Delete this asset? This cannot be undone.")) return;
    const res = await fetch(`/api/media-assets/${asset.id}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (res.ok) {
      setAssets((prev) => prev.filter((a) => a.id !== asset.id));
      setTotal((t) => Math.max(0, t - 1));
    }
  };

  const download = async (url: string, name: string) => {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      const ext = blob.type.includes("video")
        ? "mp4"
        : blob.type.includes("audio")
        ? "mp3"
        : blob.type.includes("svg")
        ? "svg"
        : blob.type.includes("jpeg")
        ? "jpg"
        : blob.type.includes("webp")
        ? "webp"
        : blob.type.includes("gif")
        ? "gif"
        : "png";
      a.download = `${name}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch {
      // ignore
    }
  };

  const foldersForKind = folders.filter((f) => f.kind === assetTypeForKind(kind));

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <FolderOpen className="size-6 text-primary" />
            Asset Library
          </h1>
          <p className="text-muted-foreground mt-1">
            Every generated image, brand asset, video, and voice clip in this
            workspace — organized into folders.
          </p>
        </div>
      </div>

      {/* Kind tabs */}
      <div className="flex items-center gap-2 border-b pb-2 overflow-x-auto">
        {KIND_TABS.map(({ kind: k, label, icon: Icon }) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            className={`text-sm font-medium px-3 py-1.5 rounded-t-md transition-colors whitespace-nowrap ${
              kind === k ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="size-3 inline mr-1" /> {label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-6 items-start">
        {/* Folder sidebar */}
        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Folders</h2>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => createFolder()} disabled={!newFolderName.trim()}>
              <FolderPlus className="size-3.5 mr-1" /> Add
            </Button>
          </div>
          <div className="flex items-center gap-1.5">
            <input
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createFolder()}
              placeholder="New folder…"
              className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs"
            />
          </div>

          <div className="space-y-1">
            <button
              onClick={() => { setSelectedFolder(null); setUnfiled(false); }}
              className={`w-full text-left text-xs px-2 py-1.5 rounded-md transition-colors ${
                !selectedFolder && !unfiled ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-muted"
              }`}
            >
              All {KIND_TABS.find((t) => t.kind === kind)?.label ?? ""}
            </button>
            <button
              onClick={() => { setSelectedFolder(null); setUnfiled(true); }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => onDropOnFolder(e, "")}
              className={`w-full text-left text-xs px-2 py-1.5 rounded-md transition-colors ${
                unfiled ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-muted"
              }`}
              title="Drop an asset here to unfile it"
            >
              Unfiled
            </button>
            {foldersForKind.map((f) => (
              <div
                key={f.id}
                className={`group flex items-center gap-1 rounded-md px-2 py-1.5 cursor-pointer transition-colors ${
                  selectedFolder === f.id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"
                }`}
                onClick={() => { setSelectedFolder(f.id); setUnfiled(false); }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => onDropOnFolder(e, f.id)}
                title={`Drop an asset here to file it in ${f.name}`}
              >
                {renamingId === f.id ? (
                  <>
                    <input
                      autoFocus
                      value={renamingName}
                      onChange={(e) => setRenamingName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") renameFolder(f.id);
                        if (e.key === "Escape") setRenamingId(null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="w-full rounded border border-input bg-background px-1.5 py-0.5 text-xs"
                    />
                    <button onClick={(e) => { e.stopPropagation(); renameFolder(f.id); }} className="text-green-600"><Check className="size-3" /></button>
                  </>
                ) : (
                  <>
                    <FolderOpen className="size-3.5 shrink-0" />
                    <span className="flex-1 truncate text-xs">{f.name}</span>
                    <span className="hidden group-hover:flex items-center gap-0.5">
                      <button
                        onClick={(e) => { e.stopPropagation(); setRenamingId(f.id); setRenamingName(f.name); }}
                        className="p-0.5 rounded hover:bg-muted-foreground/20"
                        title="Rename"
                      >
                        <Pencil className="size-3" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteFolder(f.id); }}
                        className="p-0.5 rounded hover:bg-red-500/20 text-red-500"
                        title="Delete folder"
                      >
                        <Trash2 className="size-3" />
                      </button>
                    </span>
                  </>
                )}
              </div>
            ))}
          </div>
        </Card>

        {/* Asset grid */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <div className="relative flex-1 max-w-xs">
              <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search prompts…"
                className="w-full rounded-md border border-input bg-background pl-8 pr-3 py-1.5 text-sm"
              />
            </div>
            <span className="text-xs text-muted-foreground">{total} asset{total === 1 ? "" : "s"}</span>
          </div>

          {error && (
            <div className="p-3 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-sm text-amber-800 dark:text-amber-200">
              {error}
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : assets.length === 0 ? (
            <Card className="p-12 text-center text-muted-foreground">
              <FolderOpen className="size-12 mx-auto mb-3 opacity-20" />
              <p className="text-sm">No {KIND_TABS.find((t) => t.kind === kind)?.label.toLowerCase()} assets here yet.</p>
              <p className="text-xs mt-1">
                {kind === "brand"
                  ? "Generate brand assets from Brand & Vector Design and they'll appear here."
                  : kind === "video"
                  ? "Generate videos and they'll appear here."
                  : kind === "voice"
                  ? "Generate voice clips and they'll appear here."
                  : "Generate images and they'll appear here."}
              </p>
            </Card>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
              {assets.map((asset) => {
                const src = asset.thumbnail_url || asset.url;
                return (
                  <Card
                    key={asset.id}
                    draggable
                    onDragStart={(e) => onDragStart(e, asset.id)}
                    className="overflow-hidden group/card cursor-grab active:cursor-grabbing"
                  >
                    <div className="aspect-square bg-muted relative">
                      {kind === "video" && src ? (
                        <video src={src} className="w-full h-full object-cover" muted playsInline preload="metadata" />
                      ) : kind === "voice" ? (
                        <div className="w-full h-full flex items-center justify-center bg-muted">
                          <audio controls src={asset.url ?? undefined} className="w-11/12" />
                        </div>
                      ) : src ? (
                        <img
                          src={src}
                          alt={asset.prompt}
                          className="w-full h-full object-cover"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                          <ImageIcon className="size-8 opacity-30" />
                        </div>
                      )}
                      <span className="absolute bottom-2 left-2 px-1.5 py-0.5 rounded text-[9px] font-medium bg-black/60 text-white">
                        {asset.task === "brand_design" ? "Brand" : asset.type}
                      </span>
                    </div>
                    <div className="p-2.5 space-y-1.5">
                      <p className="text-xs text-muted-foreground line-clamp-2" title={asset.prompt}>
                        {asset.prompt}
                      </p>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-muted-foreground">
                          {new Date(asset.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                        </span>
                        <div className="flex items-center gap-1">
                          {asset.url && (
                            <button
                              onClick={() => download(asset.url!, `asset-${asset.id.slice(0, 8)}`)}
                              className="p-1 rounded hover:bg-muted text-muted-foreground"
                              title="Download"
                            >
                              <Download className="size-3.5" />
                            </button>
                          )}
                          <button
                            onClick={() => deleteAsset(asset)}
                            className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900 text-muted-foreground hover:text-red-600"
                            title="Delete"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      </div>
                      {foldersForKind.length > 0 && (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => autoFile(asset)}
                            className="p-1 rounded hover:bg-purple-100 dark:hover:bg-purple-900 text-purple-600 shrink-0"
                            title={
                              suggestFolder(asset.prompt, foldersForKind)
                                ? `File into "${suggestFolder(asset.prompt, foldersForKind)!.name}"`
                                : "No matching folder — create one first"
                            }
                          >
                            <Wand2 className="size-3" />
                          </button>
                          <select
                            value={moveTarget[asset.id] ?? ""}
                            onChange={(e) => setMoveTarget((prev) => ({ ...prev, [asset.id]: e.target.value }))}
                            className="w-full rounded border border-input bg-background px-1.5 py-1 text-[10px]"
                          >
                            <option value="">{asset.folder_id ? "Move to folder…" : "File in folder…"}</option>
                            {foldersForKind
                              .filter((f) => f.id !== asset.folder_id)
                              .map((f) => (
                                <option key={f.id} value={f.id}>{f.name}</option>
                              ))}
                            {asset.folder_id && <option value="">Unfile</option>}
                          </select>
                          <button
                            onClick={() => moveAsset(asset, moveTarget[asset.id] ?? "")}
                            disabled={!moveTarget[asset.id]}
                            className="p-1 rounded hover:bg-purple-100 dark:hover:bg-purple-900 text-purple-600 disabled:opacity-40"
                            title="Apply folder"
                          >
                            <FolderInput className="size-3" />
                          </button>
                        </div>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
