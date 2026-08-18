"use client";

import { useCallback, useEffect, useState, useTransition, useRef } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Trash2, FolderPlus, Folder, FileText, Link2, Upload, Globe, File, AlertCircle, ArrowLeft, RefreshCw, HardDrive } from "lucide-react";
import Link from "next/link";
import { getFolders, createFolder, deleteFolder, getItems, addUrlItem, addTextItem, deleteItem, type KbFolder, type KbItem } from "@/lib/knowledgebase";
import { uploadFile } from "./actions";

const typeIcons: Record<string, any> = {
  url: Globe,
  doc: FileText,
  image: File,
  video: File,
  text: FileText,
};

const statusColors: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-700",
  scraping: "bg-blue-100 text-blue-700",
  extracting: "bg-blue-100 text-blue-700",
  ready: "bg-green-100 text-green-700",
  error: "bg-red-100 text-red-700",
};

export default function KnowledgebasePage() {
  const params = useParams();
  const workspaceId = params.id as string;

  const [folders, setFolders] = useState<KbFolder[]>([]);
  const [items, setItems] = useState<KbItem[]>([]);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: string; message: string } | null>(null);
  const [isLoading, startLoading] = useTransition();
  const [isPending, startTransition] = useTransition();
  const [showAddFolder, setShowAddFolder] = useState(false);
  const [showAddUrl, setShowAddUrl] = useState(false);
  const [showAddText, setShowAddText] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [urlName, setUrlName] = useState("");
  const [urlValue, setUrlValue] = useState("");
  const [textName, setTextName] = useState("");
  const [textValue, setTextValue] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [driveSavingId, setDriveSavingId] = useState<string | null>(null);

  const saveToDrive = (item: KbItem) => {
    setDriveSavingId(item.id);
    setFeedback(null);
    fetch(`/api/knowledgebase/${item.id}/drive`, { method: "POST", credentials: "include" })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (res.ok) setFeedback({ type: "success", message: `Saved to Google Drive: ${data.file?.name ?? "file"}` });
        else setFeedback({ type: "error", message: data.error ?? "Failed to save to Google Drive" });
      })
      .catch(() => setFeedback({ type: "error", message: "Failed to save to Google Drive" }))
      .finally(() => setDriveSavingId(null));
  };

  const load = useCallback(() => {
    startLoading(async () => {
      // workspaceId is the route param — items must NEVER fall back to the
      // cookie workspace here, or another workspace's knowledge base leaks in.
      const [fRes, iRes] = await Promise.all([
        getFolders(currentFolderId, workspaceId),
        getItems(currentFolderId, workspaceId),
      ]);
      if (fRes.success && fRes.data) setFolders(fRes.data);
      if (iRes.success && iRes.data) setItems(iRes.data);
    });
  }, [currentFolderId, workspaceId]);

  useEffect(() => { load(); }, [load]);

  // Poll for scraping status
  useEffect(() => {
    const hasPending = items.some((i) => i.status === "pending" || i.status === "scraping" || i.status === "extracting");
    if (hasPending) {
      const timer = setInterval(load, 3000);
      return () => clearInterval(timer);
    }
  }, [items, load]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    formData.append("name", file.name);
    if (currentFolderId) formData.append("folderId", currentFolderId);

    startTransition(async () => {
      const res = await uploadFile(workspaceId, formData);
      if (res.success) { setFeedback({ type: "success", message: "File uploaded." }); load(); }
      else setFeedback({ type: "error", message: res.error ?? "Upload failed." });
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleAddFolder = () => {
    if (!newFolderName.trim()) return;
    startTransition(async () => {
      const res = await createFolder(newFolderName, currentFolderId, workspaceId);
      if (res.success) { setNewFolderName(""); setShowAddFolder(false); setFeedback({ type: "success", message: "Folder created." }); load(); }
      else setFeedback({ type: "error", message: res.error ?? "Failed." });
    });
  };

  const handleAddUrl = () => {
    if (!urlName.trim() || !urlValue.trim()) return;
    startTransition(async () => {
      const res = await addUrlItem(urlName, urlValue, currentFolderId, workspaceId);
      if (res.success) { setUrlName(""); setUrlValue(""); setShowAddUrl(false); setFeedback({ type: "success", message: "URL added. Scraping in background..." }); load(); }
      else setFeedback({ type: "error", message: res.error ?? "Failed." });
    });
  };

  const handleAddText = () => {
    if (!textName.trim() || !textValue.trim()) return;
    startTransition(async () => {
      const res = await addTextItem(textName, textValue, currentFolderId, workspaceId);
      if (res.success) { setTextName(""); setTextValue(""); setShowAddText(false); setFeedback({ type: "success", message: "Text snippet saved." }); load(); }
      else setFeedback({ type: "error", message: res.error ?? "Failed." });
    });
  };

  const handleDeleteItem = (id: string, name: string) => {
    if (!confirm(`Delete "${name}"?`)) return;
    startTransition(async () => { await deleteItem(id, workspaceId); load(); });
  };

  const handleDeleteFolder = (id: string, name: string) => {
    if (!confirm(`Delete folder "${name}" and all contents?`)) return;
    startTransition(async () => { await deleteFolder(id, workspaceId); load(); });
  };

  const navigateToFolder = (folderId: string | null) => {
    setCurrentFolderId(folderId);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Link href="/dashboard/workspaces"><Button variant="ghost" size="sm"><ArrowLeft className="size-4" /></Button></Link>
            <h1 className="text-2xl font-bold tracking-tight">Knowledgebase</h1>
          </div>
          <p className="text-muted-foreground text-sm mt-1">Organize brand knowledge, scraped URLs, uploaded files, and reference material.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input ref={fileInputRef} type="file" className="hidden" onChange={handleUpload} accept=".pdf,.doc,.docx,.txt,.md,.csv,.png,.jpg,.jpeg,.webp,.svg,.mp4,.mov,.webm" />
          <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={isPending}><Upload className="size-3 mr-1" /> Upload</Button>
          <Button variant="outline" size="sm" onClick={() => setShowAddUrl(!showAddUrl)} disabled={isPending}><Globe className="size-3 mr-1" /> Add URL</Button>
          <Button variant="outline" size="sm" onClick={() => setShowAddText(!showAddText)} disabled={isPending}><FileText className="size-3 mr-1" /> Add Text</Button>
          <Button variant="outline" size="sm" onClick={() => setShowAddFolder(!showAddFolder)} disabled={isPending}><FolderPlus className="size-3 mr-1" /> New Folder</Button>
          <Button variant="ghost" size="icon" onClick={load} disabled={isPending}><RefreshCw className="size-4" /></Button>
        </div>
      </div>

      {/* Breadcrumb */}
      <div className="flex items-center gap-1 text-sm text-muted-foreground">
        <button onClick={() => navigateToFolder(null)} className="hover:text-foreground">Root</button>
        {currentFolderId && <><span>/</span><Folder className="size-3" /><span className="text-foreground">{folders.find(f => f.id === currentFolderId)?.name ?? "..."}</span></>}
      </div>

      {feedback && (
        <div className={`p-3 rounded-md text-sm ${feedback.type === "success" ? "bg-green-50 text-green-700 border-green-200" : "bg-red-50 text-red-700 border-red-200"} border`} role="alert">
          {feedback.message}<button className="ml-3 underline text-xs" onClick={() => setFeedback(null)}>Dismiss</button>
        </div>
      )}

      {/* Add folder form */}
      {showAddFolder && (
        <Card><CardContent className="pt-6 space-y-4"><div className="flex items-center gap-4"><Input placeholder="Folder name" value={newFolderName} onChange={e => setNewFolderName(e.target.value)} disabled={isPending} className="flex-1" /><Button onClick={handleAddFolder} disabled={isPending || !newFolderName.trim()}>Create</Button></div></CardContent></Card>
      )}

      {/* Add URL form */}
      {showAddUrl && (
        <Card><CardContent className="pt-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4"><div className="space-y-2"><Label>Name</Label><Input placeholder="Competitor homepage" value={urlName} onChange={e => setUrlName(e.target.value)} disabled={isPending} /></div><div className="space-y-2"><Label>URL</Label><Input placeholder="https://example.com" value={urlValue} onChange={e => setUrlValue(e.target.value)} disabled={isPending} /></div></div>
          <Button onClick={handleAddUrl} disabled={isPending || !urlName.trim() || !urlValue.trim()}>Scrape & Save</Button>
        </CardContent></Card>
      )}

      {/* Add text form */}
      {showAddText && (
        <Card><CardContent className="pt-6 space-y-4">
          <div className="space-y-2"><Label>Name</Label><Input placeholder="Brand voice notes" value={textName} onChange={e => setTextName(e.target.value)} disabled={isPending} /></div>
          <div className="space-y-2"><Label>Content</Label><textarea className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50" placeholder="Type or paste your reference text here..." value={textValue} onChange={e => setTextValue(e.target.value)} rows={5} disabled={isPending} /></div>
          <Button onClick={handleAddText} disabled={isPending || !textName.trim() || !textValue.trim()}>Save Text</Button>
        </CardContent></Card>
      )}

      {/* Folders */}
      {folders.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-muted-foreground mb-2">Folders</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {folders.map((f) => (
              // Outer row is a div (not a button) so the inner delete button
              // stays valid HTML — nested <button> causes hydration errors.
              <div
                key={f.id}
                role="button"
                tabIndex={0}
                onClick={() => navigateToFolder(f.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    navigateToFolder(f.id);
                  }
                }}
                className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors text-left cursor-pointer"
              >
                <span className="flex items-center gap-2 truncate"><Folder className="size-4 text-yellow-500 shrink-0" />{f.name}</span>
                <button onClick={(e) => { e.stopPropagation(); handleDeleteFolder(f.id, f.name); }} className="shrink-0 text-muted-foreground hover:text-destructive"><Trash2 className="size-3" /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Items */}
      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="size-8 animate-spin text-muted-foreground" /></div>
      ) : items.length === 0 && folders.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <FolderPlus className="size-12 mx-auto mb-4 opacity-30" />
          <p className="text-sm">This folder is empty.</p>
          <p className="text-xs mt-1">Upload files, add URLs to scrape, or create text snippets to build your knowledgebase.</p>
        </div>
      ) : (
        <div className="space-y-1">
          {items.map((item) => {
            const Icon = typeIcons[item.type] ?? FileText;
            const isPublicUrl = (item.extracted_metadata as any)?.publicUrl;
            return (
              <div key={item.id} className="flex items-center justify-between p-3 rounded-lg border">
                <div className="flex items-center gap-3 min-w-0">
                  <Icon className="size-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{item.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Badge variant="outline" className="text-[10px] px-1">{item.type}</Badge>
                      <Badge className={`text-[10px] px-1 ${statusColors[item.status]}`}>{item.status}</Badge>
                      {item.status === "error" && <span className="text-[10px] text-red-500 flex items-center gap-0.5"><AlertCircle className="size-2.5" /> {item.error_message?.substring(0, 40)}</span>}
                      {isPublicUrl && item.type === "image" && (
                        <img src={isPublicUrl} alt={item.name} className="h-6 w-auto object-cover rounded" />
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {isPublicUrl && <a href={isPublicUrl} target="_blank" rel="noopener noreferrer"><Button variant="ghost" size="icon" className="h-7 w-7"><Link2 className="size-3" /></Button></a>}
                  {item.storage_path && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-emerald-600 hover:bg-emerald-100 dark:hover:bg-emerald-900"
                      onClick={() => saveToDrive(item)}
                      disabled={isPending || driveSavingId === item.id}
                      title="Save to the workspace's attached Google Drive folder"
                    >
                      {driveSavingId === item.id ? <Loader2 className="size-3 animate-spin" /> : <HardDrive className="size-3" />}
                    </Button>
                  )}
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => handleDeleteItem(item.id, item.name)} disabled={isPending}><Trash2 className="size-3" /></Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}