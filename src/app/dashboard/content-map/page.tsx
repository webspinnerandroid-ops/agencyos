"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Loader2,
  Upload,
  Sparkles,
  Check,
  X,
  AlertTriangle,
  StopCircle,
  FileText,
  Map as MapIcon,
  Globe,
  FileDown,
  Pencil,
  CalendarClock,
  ShieldQuestion,
} from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// ---------------------------------------------------------------------------
// Types (mirror the API response)
// ---------------------------------------------------------------------------

interface MapItem {
  id: string;
  source_row: number | null;
  title: string;
  keywords: string[];
  topic: string | null;
  content_type: "blog" | "social";
  platforms: string[];
  /** Preferred external sources (optional CSV column). Empty = none. */
  external_links: string[];
  /** Planned publish slot (ISO) — CSV Publish Date column or the row picker. */
  scheduled_at: string | null;
  /** Automation target ("wordpress" = auto-schedule gate-cleared drafts). */
  auto_publish: "wordpress" | null;
  status: "planned" | "generating" | "done" | "failed" | "dismissed";
  linked_post_id: string | null;
  gate: {
    gate: number;
    attempts: number;
    retries: number;
    history: { attempt: number; seo: number; aeoGeo: number; belowGate: boolean }[];
  } | null;
  error: string | null;
  import_note: string | null;
  created_at: string;
  updated_at: string;
}

interface Client {
  id: string;
  name: string;
}

/** One WordPress/social publish attempt for a row's linked draft. */
interface PublishLogEntry {
  platform: string;
  attemptAt: string;
  success: boolean;
  siteName: string | null;
  targetUrl: string | null;
  error: string | null;
}

/** Linked draft state — drives the hold countdown + history panel. */
interface LinkedPostState {
  autoPublishAt: string | null;
  postStatus: string | null;
  scheduledAt: string | null;
}

interface ImportResult {
  importId: string;
  imported: number;
  skipped: { rowNumber: number; reason: string }[];
  notes: { row: number; note: string }[];
}

const STATUS_STYLES: Record<MapItem["status"], string> = {
  planned: "bg-muted text-muted-foreground",
  generating: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  done: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
  failed: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  dismissed: "bg-muted text-muted-foreground line-through",
};

/** ISO → the `datetime-local` input's expected "YYYY-MM-DDTHH:mm" (local). */
function toDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Placeholder detector (mirrors the importer's GENERIC_TITLE_PATTERN) —
 * rows like "Blog Promotion" with no keywords get their real topic invented
 * from the client's business + season at generation time; the dry-run flags
 * them so that behavior is visible before it runs.
 */
const GENERIC_TITLE_PATTERN =
  /^(blog|social|gbp|google business profile?|property|local attraction|guest experience|staff|industry|community|call to action|cta|behind the scenes|event|holiday|seasonal|testimonials?|promotion|announcement)( (post|promotion|update|content|highlight|spotlight|insight|story|moment|review|message)s?)?$/i;
function isPlaceholderTitle(title: string): boolean {
  return GENERIC_TITLE_PATTERN.test(title.trim());
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ContentMapPage() {
  const [items, setItems] = useState<MapItem[]>([]);
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [history, setHistory] = useState<Record<string, PublishLogEntry[]>>({});
  const [linkedPosts, setLinkedPosts] = useState<Record<string, LinkedPostState>>({});
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState("");
  const [brandVoice, setBrandVoice] = useState("");
  // Images per generated post: fixed 1/2/3, or "auto" = illustrate key
  // points (the model chooses where images genuinely support the content).
  const [imagePref, setImagePref] = useState<number | "auto">("auto");
  // Client site upload (internal links). All optional — no site uploaded is
  // a normal state and generation works fine without it.
  const [siteUrl, setSiteUrl] = useState("");
  const [siteUploading, setSiteUploading] = useState(false);
  const [siteNote, setSiteNote] = useState<string | null>(null);
  const [sitePages, setSitePages] = useState(0);
  const [showDismissed, setShowDismissed] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // ---- View modes: list (default), timeline, board (bulk edit) ----
  const [view, setView] = useState<"list" | "timeline">("list");
  // ---- Bulk row editor: rows with local edits (staged until Save). ----
  const [editing, setEditing] = useState<
    Record<string, { title: string; topic: string; keywords: string }>
  >({});
  const [savingEdits, setSavingEdits] = useState(false);
  // ---- Dry-run: preview of what "Generate all" would do. ----
  const [dryRun, setDryRun] = useState<{
    open: boolean;
    loading: boolean;
    rows: {
      id: string;
      title: string;
      type: string;
      scheduledAt: string | null;
      placeholder: boolean;
      cost: number;
    }[];
  }>({ open: false, loading: false, rows: [] });

  const loadMap = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (clientId) params.set("clientId", clientId);
      const res = await fetch(`/api/content-map?${params.toString()}`, {
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) {
        setPageError(data.error ?? "Failed to load the content map");
        return;
      }
      setItems(data.items ?? []);
      setSummary(data.summary ?? {});
      setHistory(data.history ?? {});
      setLinkedPosts(data.linkedPosts ?? {});
    } catch {
      setPageError("Network error loading the content map");
    }
  }, [clientId]);

  useEffect(() => {
    loadMap();
  }, [loadMap]);

  // Poll the server-side batch runner while it's active. The loop lives on
  // the server (it survives leaving this page); polling only refreshes the
  // rows and progress so the view stays current. It self-stops when idle.
  useEffect(() => {
    if (!batchRunning) return;
    const t = setInterval(async () => {
      try {
        const res = await fetch("/api/content-map/batch", { credentials: "include" });
        const s = await res.json().catch(() => null);
        if (s?.running) {
          setBatchProgress({ done: s.done ?? 0, total: s.total ?? 0 });
        } else {
          setBatchRunning(false);
          setBatchProgress(null);
          await loadMap();
        }
      } catch {
        // transient network hiccup — next tick retries
      }
    }, 5000);
    return () => clearInterval(t);
  }, [batchRunning, loadMap]);

  // A batch may be running from a PREVIOUS session (or another tab). Sync
  // the header state on mount so the UI reflects server truth immediately.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/content-map/batch", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        if (cancelled) return;
        if (s?.running) {
          setBatchRunning(true);
          setBatchProgress({ done: s.done ?? 0, total: s.total ?? 0 });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Clients list for the map's client selector.
  useEffect(() => {
    fetch("/api/clients", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setClients(d?.clients ?? []))
      .catch(() => {});
  }, []);

  const planned = items.filter((i) => i.status === "planned");
  const visible = items.filter((i) => showDismissed || i.status !== "dismissed");

  // ---- Timeline: rows sorted by planned publish date, undated at the end.
  const timelineRows = useMemo(
    () =>
      [...visible]
        .filter((i) => i.status !== "dismissed")
        .sort((a, b) => {
          const at = a.scheduled_at ? new Date(a.scheduled_at).getTime() : Infinity;
          const bt = b.scheduled_at ? new Date(b.scheduled_at).getTime() : Infinity;
          if (at !== bt) return at - bt;
          return a.created_at.localeCompare(b.created_at);
        }),
    [visible]
  );

  // ---- Dry-run cost model (tokens): a blog ≈ 6k (research + 1750-word
  // draft + gate re-score), a social caption ≈ 1k. Placeholder rows show a
  // flag — the model will invent their real topic at generation time.
  const dryRunRows = useMemo(
    () =>
      planned.map((i) => ({
        id: i.id,
        title: i.title,
        type: i.content_type,
        scheduledAt: i.scheduled_at,
        placeholder: isPlaceholderTitle(i.title) && i.keywords.length === 0,
        cost: i.content_type === "social" ? 1_000 : 6_000,
      })),
    [planned]
  );
  const dryRunTotal = dryRunRows.reduce((s, r) => s + r.cost, 0);

  const openDryRun = () => {
    setDryRun({ open: true, loading: false, rows: dryRunRows });
  };

  // ---- Bulk editor helpers ----
  const editValue = (item: MapItem) =>
    editing[item.id] ?? {
      title: item.title,
      topic: item.topic ?? "",
      keywords: item.keywords.join(", "),
    };
  const setEditValue = (id: string, patch: Partial<{ title: string; topic: string; keywords: string }>) =>
    setEditing((prev) => ({
      ...prev,
      [id]: { ...editValue(items.find((i) => i.id === id) as MapItem), ...patch },
    }));
  const dirtyCount = Object.keys(editing).length;

  const toggleEdit = (id: string) =>
    setEditing((prev) => {
      const next = { ...prev };
      if (next[id]) {
        delete next[id];
      } else {
        const item = items.find((i) => i.id === id);
        if (item) {
          next[id] = {
            title: item.title,
            topic: item.topic ?? "",
            keywords: item.keywords.join(", "),
          };
        }
      }
      return next;
    });

  const saveEdits = async () => {
    setSavingEdits(true);
    try {
      for (const [id, val] of Object.entries(editing)) {
        const res = await fetch(`/api/content-map/${id}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: val.title,
            topic: val.topic,
            keywords: val.keywords
              .split(",")
              .map((k) => k.trim())
              .filter(Boolean),
          }),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          setPageError(d.error ?? "Could not save the row edits.");
          break;
        }
      }
      setEditing({});
      await loadMap();
    } finally {
      setSavingEdits(false);
    }
  };

  // Kick off the client-site crawl (internal-link sources). Best-effort:
  // a failure here is a note, never a blocker for the map itself.
  const uploadSite = async () => {
    if (!siteUrl.trim()) return;
    setSiteUploading(true);
    setSiteNote(null);
    try {
      const res = await fetch("/api/content-map/site", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: siteUrl.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSiteNote(data.error ?? "Could not start the site crawl.");
        return;
      }
      setSiteNote(data.note ?? "Crawl started.");
      setSitePages(data.linkableNow ?? sitePages);
    } catch {
      setSiteNote("Network error starting the site crawl.");
    } finally {
      setSiteUploading(false);
    }
  };

  // Linkable-page count on load (how many crawled pages can be linked).
  useEffect(() => {
    fetch("/api/content-map/site", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setSitePages((d?.pages ?? []).length))
      .catch(() => {});
  }, []);

  const handleImport = async () => {
    const file = fileRef.current?.files?.[0];
    setImportError(null);
    setImportResult(null);
    if (!file) {
      setImportError("Choose a CSV file first.");
      return;
    }
    setImporting(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (clientId) fd.append("clientId", clientId);
      if (brandVoice.trim()) fd.append("brandVoice", brandVoice.trim());
      const res = await fetch("/api/content-map", {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) {
        setImportError(data.error ?? "Import failed");
        return;
      }
      setImportResult(data as ImportResult);
      if (fileRef.current) fileRef.current.value = "";
      await loadMap();
    } catch {
      setImportError("Network error during import");
    } finally {
      setImporting(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Server-side batch runner: the UI only STARTS the run and POLLS status.
  // Row states live in the DB (planned → generating → done/failed), so the
  // loop survives navigating away from this page — the old client-side loop
  // died on navigation, silently killing the rest of the queue.
  // ---------------------------------------------------------------------------
  const batchStart = async (itemIds?: string[]) => {
    setPageError(null);
    try {
      const res = await fetch("/api/content-map/batch", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "start",
          clientId: clientId || null,
          brandVoice: brandVoice.trim() || null,
          imagePref,
          itemIds,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPageError(
          data.error ??
            (data.reason === "nothing_planned"
              ? "No planned items to generate."
              : "Could not start the batch.")
        );
        return;
      }
      setBatchRunning(true);
      setBatchProgress({ done: 0, total: data.claimed ?? 0 });
      await loadMap(); // rows flip to "generating"
    } catch {
      setPageError("Network error starting the batch.");
    }
  };

  const batchStop = async () => {
    try {
      await fetch("/api/content-map/batch", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop" }),
      });
    } catch {
      // The status poll below will reflect the stop regardless.
    }
  };
  const runBatch = async () => {
    await batchStart();
  };

  const stopBatch = async () => {
    await batchStop();
  };

  const dismiss = async (item: MapItem) => {
    await fetch(`/api/content-map/${item.id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: item.status === "dismissed" ? "restore" : "dismiss" }),
    });
    loadMap();
  };

  // Set/clear the row's planned publish slot (the datetime picker). An empty
  // value clears; otherwise the local time is sent and the server normalizes
  // to ISO. Optimistic local update; the server response is the truth.
  const scheduleItem = async (item: MapItem, value: string) => {
    const iso = value ? new Date(value).toISOString() : null;
    setItems((prev) =>
      prev.map((it) => (it.id === item.id ? { ...it, scheduled_at: iso } : it))
    );
    try {
      const res = await fetch(`/api/content-map/${item.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduledAt: iso }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setPageError(data.error ?? "Could not save the schedule.");
      }
    } catch {
      setPageError("Network error saving the schedule.");
    }
  };

  const remove = async (item: MapItem) => {
    if (!confirm(`Remove "${item.title}" from the map?`)) return;
    await fetch(`/api/content-map/${item.id}`, {
      method: "DELETE",
      credentials: "include",
    });
    loadMap();
  };

  // Cancel the 15-minute auto-publish hold on this row's linked draft. The
  // draft is kept; only the automation stops. Asks for confirmation — it's
  // the one destructive-ish action in the automation flow.
  const cancelHold = async (item: MapItem) => {
    if (
      !confirm(
        "Cancel auto-publishing this draft? It stays as a draft — you can publish it manually anytime."
      )
    )
      return;
    try {
      const res = await fetch(`/api/content-map/${item.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel_auto_publish" }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setPageError(d.error ?? "Could not cancel the auto-publish.");
      }
    } catch {
      setPageError("Network error cancelling the auto-publish.");
    }
    loadMap();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
          <MapIcon className="size-6 text-primary" />
          Content Map
        </h1>
        <p className="text-muted-foreground mt-1 max-w-2xl">
          Upload a year of ideas as a CSV, then generate each one with the full
          SEO + AEO/GEO quality gate and images — drafts land ready for the
          calendar and publishing automation.
        </p>
      </div>

      {pageError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {pageError}
        </div>
      )}

      {/* ---- Import ---- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="size-5 text-primary" />
            Import ideas (CSV)
          </CardTitle>
          <CardDescription>
            Columns: <span className="font-medium">Title</span>,{" "}
            <span className="font-medium">Keywords</span> (comma-separated — the
            first is the focus keyword), <span className="font-medium">Topic</span>,{" "}
            <span className="font-medium">Type</span> (blog/social),{" "}
            <span className="font-medium">Platforms</span>. Title or Topic is
            required per row.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="map-images">Images per post</Label>
              <select
                id="map-images"
                value={String(imagePref)}
                onChange={(e) =>
                  setImagePref(
                    e.target.value === "auto" ? "auto" : Number(e.target.value)
                  )
                }
                disabled={importing || batchRunning}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="1">1 — featured image</option>
                <option value="2">2 — featured + 1 inline</option>
                <option value="3">3 — featured + 2 inline</option>
                <option value="auto">To illustrate key points (recommended)</option>
              </select>
              <p className="text-xs text-muted-foreground">
                &quot;Illustrate key points&quot; lets the model place images where they
                genuinely support the content, capped at 3.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="map-client">Client for this map</Label>
              <select
                id="map-client"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                disabled={importing || batchRunning}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">No client (agency content)</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="map-voice">Brand voice (applies to every row)</Label>
              {/* grid is sm:grid-cols-3 — the client + voice fields share the row */}
              <Input
                id="map-voice"
                value={brandVoice}
                onChange={(e) => setBrandVoice(e.target.value)}
                placeholder="Professional, friendly, and approachable"
                disabled={importing || batchRunning}
              />
            </div>
          </div>

          {/* Internal links come from the client's existing site — upload it
              into the workspace knowledge base so its pages get crawled and
              become link targets. Optional: generation works without it. */}
          <div className="rounded-md border bg-muted/30 p-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <Label htmlFor="site-url">Client website (internal links)</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Upload the client&apos;s existing site so its pages get crawled and
                  become internal-link targets for every generated post.
                  {sitePages > 0 && <span className="ml-1">{sitePages} page{sitePages === 1 ? "" : "s"} linkable.</span>}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  id="site-url"
                  value={siteUrl}
                  onChange={(e) => setSiteUrl(e.target.value)}
                  placeholder="https://decorehotels.com"
                  className="w-56"
                  disabled={siteUploading || batchRunning}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={uploadSite}
                  disabled={siteUploading || batchRunning || !siteUrl.trim()}
                >
                  {siteUploading ? <Loader2 className="size-4 animate-spin" /> : <Globe className="size-4 mr-1" />}
                  Crawl site
                </Button>
              </div>
            </div>
            {siteNote && <p className="text-xs text-muted-foreground">{siteNote}</p>}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              disabled={importing || batchRunning}
              className="text-sm"
            />
            <Button onClick={handleImport} disabled={importing || batchRunning}>
              {importing ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Importing…
                </>
              ) : (
                <>
                  <Upload className="size-4" /> Upload CSV
                </>
              )}
            </Button>
            <a
              href="/content-map-template.csv"
              download
              className="text-xs text-primary underline hover:no-underline inline-flex items-center gap-1"
            >
              <FileDown className="size-3.5" /> CSV template
            </a>
          </div>

          {importError && (
            <p className="text-sm text-destructive">{importError}</p>
          )}
          {importResult && (
            <div className="rounded-md border bg-muted/40 p-3 text-sm space-y-2">
              <p>
                <span className="font-medium text-green-700 dark:text-green-400">
                  Imported {importResult.imported} idea{importResult.imported === 1 ? "" : "s"}.
                </span>
              </p>
              {/* Skipped rows get TOP billing: a 325-row calendar template
                  importing as 6 rows must never be a mystery. */}
              {importResult.skipped.length > 0 && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 space-y-1">
                  <p className="font-medium text-amber-800 dark:text-amber-300 text-xs">
                    <AlertTriangle className="size-3.5 inline mr-1" />
                    Skipped {importResult.skipped.length} row
                    {importResult.skipped.length === 1 ? "" : "s"} — placeholder
                    calendar entries ("Blog Promotion", "Local Attraction"…) with
                    no topic of their own.
                  </p>
                  <p className="text-[11px] text-amber-700 dark:text-amber-400">
                    These are category names, not topics. To import one, give the
                    row a real Title/Topic — or edit a planned row here later.
                  </p>
                  <ul className="text-[11px] text-amber-700 dark:text-amber-400 space-y-0.5 max-h-32 overflow-y-auto">
                    {importResult.skipped.slice(0, 40).map((s) => (
                      <li key={s.rowNumber}>
                        Row {s.rowNumber}: {s.reason}
                      </li>
                    ))}
                    {importResult.skipped.length > 40 && (
                      <li>…and {importResult.skipped.length - 40} more</li>
                    )}
                  </ul>
                </div>
              )}
              {importResult.notes.length > 0 && (
                <ul className="text-xs text-muted-foreground space-y-0.5">
                  {importResult.notes.slice(0, 8).map((n) => (
                    <li key={n.row}>
                      Row {n.row}: {n.note}
                    </li>
                  ))}
                  {importResult.notes.length > 8 && (
                    <li>…and {importResult.notes.length - 8} more</li>
                  )}
                </ul>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---- The map ---- */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Map items</CardTitle>
              <CardDescription>
                {planned.length} planned · {summary.done ?? 0} generated ·{" "}
                {summary.failed ?? 0} failed · {summary.dismissed ?? 0} dismissed
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={showDismissed}
                  onChange={(e) => setShowDismissed(e.target.checked)}
                />
                Show dismissed
              </label>
              {/* View switch: list vs timeline (publish-date order). */}
              <div className="flex rounded-md border overflow-hidden text-xs">
                <button
                  onClick={() => setView("list")}
                  className={`px-2 py-1.5 inline-flex items-center gap-1 ${view === "list" ? "bg-muted font-medium" : "hover:bg-muted/50"}`}
                  title="List view"
                >
                  <FileText className="size-3.5" /> List
                </button>
                <button
                  onClick={() => setView("timeline")}
                  className={`px-2 py-1.5 inline-flex items-center gap-1 ${view === "timeline" ? "bg-muted font-medium" : "hover:bg-muted/50"}`}
                  title="Timeline — sorted by planned publish date"
                >
                  <CalendarClock className="size-3.5" /> Timeline
                </button>
              </div>
              {dirtyCount > 0 && (
                <Button size="sm" onClick={saveEdits} disabled={savingEdits}>
                  {savingEdits ? (
                    <Loader2 className="size-4 mr-1.5 animate-spin" />
                  ) : (
                    <Check className="size-4 mr-1.5" />
                  )}
                  Save {dirtyCount} edit{dirtyCount === 1 ? "" : "s"}
                </Button>
              )}
              {batchRunning ? (
                <Button variant="destructive" size="sm" onClick={stopBatch}>
                  <StopCircle className="size-4 mr-1.5" />
                  Stop after this one
                </Button>
              ) : (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={openDryRun}
                    disabled={planned.length === 0}
                    title="See exactly what will generate, and the token cost, before anything runs"
                  >
                    <ShieldQuestion className="size-4 mr-1.5" />
                    Preview run
                  </Button>
                  <Button
                    size="sm"
                    onClick={runBatch}
                    disabled={planned.length === 0}
                  >
                    <Sparkles className="size-4 mr-1.5" />
                    Generate all ({planned.length})
                  </Button>
                </>
              )}
            </div>
          </div>
          {batchRunning && batchProgress && (
            <div className="text-xs text-muted-foreground">
              Generating {batchProgress.done}/{batchProgress.total} — one at a
              time so every piece clears the full quality gate. You can leave
              this page — the run continues on the server and rows update when
              you come back.
            </div>
          )}
        </CardHeader>
        <CardContent>
          {/* ---- Timeline view: the year's schedule at a glance, ordered by
              planned publish date (undated rows sink to the bottom). ---- */}
          {view === "timeline" && visible.length > 0 && (
            <ol className="relative border-l ml-3 space-y-4">
              {timelineRows.map((item) => {
                const d = item.scheduled_at ? new Date(item.scheduled_at) : null;
                return (
                  <li key={item.id} className="pl-6 relative">
                    <span
                      className={`absolute -left-[7px] top-1.5 size-3.5 rounded-full border-2 border-background ${
                        item.status === "done"
                          ? "bg-green-500"
                          : item.status === "generating"
                            ? "bg-blue-500 animate-pulse"
                            : item.status === "failed"
                              ? "bg-red-500"
                              : d
                                ? "bg-primary"
                                : "bg-muted-foreground/40"
                      }`}
                      title={item.status}
                    />
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="text-xs font-medium tabular-nums w-32 shrink-0">
                        {d
                          ? d.toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })
                          : "—"}
                        {d && (
                          <span className="text-muted-foreground font-normal">
                            {" "}
                            {d.toLocaleTimeString("en-US", {
                              hour: "numeric",
                              minute: "2-digit",
                            })}
                          </span>
                        )}
                      </span>
                      <span className={`text-sm ${item.status === "dismissed" ? "line-through text-muted-foreground" : ""}`}>
                        {item.title}
                      </span>
                      {item.content_type === "social" && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground capitalize">
                          social
                        </span>
                      )}
                      {item.auto_publish === "wordpress" && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                          auto → WordPress
                        </span>
                      )}
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded-full capitalize ${STATUS_STYLES[item.status]}`}
                      >
                        {item.status}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}

          {/* ---- List view (default) ---- */}
          {view === "list" && (visible.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Nothing on the map yet — upload a CSV of ideas above.
            </p>
          ) : (
            <ul className="divide-y">
              {visible.map((item) => (
                <li key={item.id} className="py-3 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded-full capitalize ${STATUS_STYLES[item.status]}`}
                    >
                      {item.status === "generating" && (
                        <Loader2 className="size-3 inline animate-spin mr-1" />
                      )}
                      {item.status}
                    </span>
                    {editing[item.id] ? (
                      <Input
                        value={editValue(item).title}
                        onChange={(e) => setEditValue(item.id, { title: e.target.value })}
                        className="h-7 flex-1 min-w-48 text-sm"
                        aria-label="Row title"
                      />
                    ) : (
                      <span className="text-sm font-medium">{item.title}</span>
                    )}
                    {item.content_type === "social" && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground capitalize">
                        social · {item.platforms.join(", ")} · generates platform-native posts (no blog)
                      </span>
                    )}
                    {item.auto_publish === "wordpress" && (
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                        title="Gate-cleared drafts auto-approve and schedule to the connected WordPress sites on the planned publish date"
                      >
                        auto → WordPress
                      </span>
                    )}
                    <div className="ml-auto flex items-center gap-1">
                      {item.linked_post_id && (
                        <a
                          href={`/dashboard/posts?post=${item.linked_post_id}`}
                          className="text-xs text-primary underline hover:no-underline inline-flex items-center gap-1"
                        >
                          <FileText className="size-3" /> View draft
                        </a>
                      )}
                      {item.status === "planned" && !batchRunning && (
                        <button
                          onClick={() => batchStart([item.id])}
                          className="text-xs px-2 py-1 rounded-md border hover:bg-muted inline-flex items-center gap-1"
                        >
                          <Sparkles className="size-3" /> Generate
                        </button>
                      )}
                      {item.status !== "done" && item.status !== "generating" && (
                        <button
                          onClick={() => toggleEdit(item.id)}
                          className="text-xs px-2 py-1 rounded-md border hover:bg-muted inline-flex items-center gap-1"
                          title="Edit this row's title, topic, and keywords inline"
                        >
                          <Pencil className="size-3" /> {editing[item.id] ? "Close" : "Edit"}
                        </button>
                      )}
                      <button
                        onClick={() => dismiss(item)}
                        className="text-xs px-2 py-1 rounded-md border hover:bg-muted"
                        title={item.status === "dismissed" ? "Restore" : "Dismiss"}
                      >
                        {item.status === "dismissed" ? "Restore" : "Dismiss"}
                      </button>
                      <button
                        onClick={() => remove(item)}
                        className="text-xs px-2 py-1 rounded-md border border-red-200 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                  </div>
                  {editing[item.id] ? (
                    <div className="grid gap-2 sm:grid-cols-2 pl-1">
                      <div className="space-y-1">
                        <Label className="text-[10px] text-muted-foreground">
                          Topic (what the piece is about)
                        </Label>
                        <Textarea
                          rows={2}
                          className="text-xs"
                          value={editValue(item).topic}
                          onChange={(e) => setEditValue(item.id, { topic: e.target.value })}
                          placeholder="The specific subject this piece covers"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] text-muted-foreground">
                          Keywords (comma-separated — first is the focus keyword)
                        </Label>
                        <Input
                          className="h-7 text-xs"
                          value={editValue(item).keywords}
                          onChange={(e) => setEditValue(item.id, { keywords: e.target.value })}
                          placeholder="focus keyword, secondary, tertiary"
                        />
                      </div>
                    </div>
                  ) : (
                    (item.keywords.length > 0 || item.topic) && (
                      <p className="text-xs text-muted-foreground">
                        {item.keywords.length > 0 && (
                          <>
                            <span className="font-medium">focus:</span>{" "}
                            {item.keywords[0]}
                            {item.keywords.length > 1 && ` +${item.keywords.length - 1} more · `}
                          </>
                        )}
                        {item.topic && item.topic !== item.title && item.topic}
                      </p>
                    )
                  )}
                  {item.import_note && (
                    <p className="text-[11px] text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="size-3 inline mr-1" />
                      {item.import_note}
                    </p>
                  )}
                  {/* Planned publish slot — from the CSV's Publish Date column
                      or set here with the picker. Optional planning info. */}
                  <div className="flex items-center gap-1.5">
                    <input
                      type="datetime-local"
                      value={toDatetimeLocal(item.scheduled_at)}
                      onChange={(e) => scheduleItem(item, e.target.value)}
                      className="text-[11px] px-1.5 py-0.5 rounded-md border bg-transparent"
                      title="Planned publish date/time (optional — flows to the draft as a suggestion)"
                    />
                    {item.scheduled_at && (
                      <button
                        onClick={() => scheduleItem(item, "")}
                        className="text-[11px] text-muted-foreground hover:text-destructive"
                        title="Clear the planned date"
                      >
                        <X className="size-3" />
                      </button>
                    )}
                  </div>
                  {item.error && (
                    <p className="text-[11px] text-destructive">
                      <AlertTriangle className="size-3 inline mr-1" />
                      {item.error}
                    </p>
                  )}
                  {/* Auto-publish hold countdown + cancel (15-min grace). */}
                  {(() => {
                    const linked = item.linked_post_id
                      ? linkedPosts[item.linked_post_id]
                      : undefined;
                    if (!linked?.autoPublishAt) return null;
                    const msLeft = new Date(linked.autoPublishAt).getTime() - Date.now();
                    if (msLeft <= 0) return null;
                    const mins = Math.floor(msLeft / 60000);
                    const secs = Math.floor((msLeft % 60000) / 1000);
                    const target = item.content_type === "social" ? "social queues" : "WordPress";
                    return (
                      <div className="rounded-md border border-blue-500/40 bg-blue-500/10 px-2 py-1.5 flex flex-wrap items-center gap-2 text-[11px]">
                        <span className="text-blue-700 dark:text-blue-300">
                          Auto-publishing to {target} in {mins}:{String(secs).padStart(2, "0")}
                          {item.scheduled_at
                            ? ` — for ${new Date(item.scheduled_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                            : ""}
                        </span>
                        <button
                          onClick={() => cancelHold(item)}
                          className="px-1.5 py-0.5 rounded border border-blue-400/60 text-blue-700 dark:text-blue-300 hover:bg-blue-500/20"
                        >
                          Cancel
                        </button>
                      </div>
                    );
                  })()}
                  {/* Post-hold confirmation: the draft cleared its hold and
                      was scheduled/queued. */}
                  {item.linked_post_id &&
                    linkedPosts[item.linked_post_id]?.postStatus ===
                      "scheduled" && (
                      <p className="text-[11px] text-green-700 dark:text-green-400">
                        <Check className="size-3 inline mr-1" />
                        Auto-published — scheduled
                        {linkedPosts[item.linked_post_id]?.scheduledAt
                          ? ` for ${new Date(
                              linkedPosts[item.linked_post_id]!.scheduledAt!
                            ).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                            })}`
                          : ""}
                        .
                      </p>
                    )}
                  {/* Publishing history — every WP/social attempt for this
                      row's draft, newest first, with links to live posts. */}
                  {item.linked_post_id &&
                    (history[item.linked_post_id]?.length ?? 0) > 0 && (
                      <div className="text-[11px] space-y-0.5">
                        <p className="text-muted-foreground font-medium">
                          Publishing history
                        </p>
                        {history[item.linked_post_id]!.map((h, i) => (
                          <p key={i} className="text-muted-foreground">
                            <span
                              className={
                                h.success
                                  ? "text-green-600 dark:text-green-400"
                                  : "text-destructive"
                              }
                            >
                              {h.success ? "✓" : "✕"}
                            </span>{" "}
                            <span className="capitalize">{h.platform}</span>
                            {h.siteName ? ` → ${h.siteName}` : ""}{" "}
                            {new Date(h.attemptAt).toLocaleString("en-US", {
                              month: "short",
                              day: "numeric",
                              hour: "numeric",
                              minute: "2-digit",
                            })}
                            {h.targetUrl && (
                              <>
                                {" "}
                                <a
                                  href={h.targetUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-primary underline hover:no-underline"
                                >
                                  view post
                                </a>
                              </>
                            )}
                            {h.error && ` — ${h.error}`}
                          </p>
                        ))}
                      </div>
                    )}
                  {/* Gate story — same badge as the generate results card */}
                  {item.gate && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-400">
                        <Check className="size-3" />
                        Cleared SEO + AEO/GEO ≥ {item.gate.gate}/100
                        {item.gate.attempts > 1
                          ? ` — attempt ${item.gate.attempts}`
                          : " — first attempt"}
                      </span>
                      {item.gate.history?.length > 1 &&
                        item.gate.history.map((h) => (
                          <span
                            key={h.attempt}
                            title={
                              h.belowGate
                                ? `Attempt ${h.attempt}: below the gate — regenerated`
                                : `Attempt ${h.attempt}: cleared the gate`
                            }
                            className={`text-[10px] px-1.5 py-0.5 rounded-full border ${
                              h.belowGate
                                ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                                : "border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-400"
                            }`}
                          >
                            #{h.attempt} · SEO {h.seo} / AEO·GEO {h.aeoGeo}
                          </span>
                        ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ))}
        </CardContent>
      </Card>

      {/* ---- Dry-run preview: exactly what "Generate all" will do, and the
          token cost, before anything runs. ---- */}
      <Dialog open={dryRun.open} onOpenChange={(open) => setDryRun((d) => ({ ...d, open }))}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Preview run — {dryRun.rows.length} item{dryRun.rows.length === 1 ? "" : "s"}</DialogTitle>
            <DialogDescription>
              Nothing has run yet. These are the rows that will generate, in
              order, each through the full SEO + AEO/GEO gate.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-80 overflow-y-auto">
            <ul className="divide-y text-sm">
              {dryRun.rows.map((r, idx) => (
                <li key={r.id} className="py-2 flex items-start gap-2">
                  <span className="text-xs text-muted-foreground tabular-nums w-5 shrink-0">
                    {idx + 1}.
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{r.title}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {r.type}
                      {r.scheduledAt
                        ? ` · publishes ${new Date(r.scheduledAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                        : ""}
                      {r.placeholder && " · placeholder — topic will be invented from the client + season"}
                    </p>
                  </div>
                  <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
                    ~{(r.cost / 1000).toFixed(0)}k tokens
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <p className="text-xs text-muted-foreground">
            Estimated total: ~{dryRunTotal.toLocaleString()} tokens
            (rough — research, gate retries, and images vary per row).
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDryRun((d) => ({ ...d, open: false }))}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                setDryRun((d) => ({ ...d, open: false }));
                await runBatch();
              }}
            >
              <Sparkles className="size-4 mr-1.5" />
              Run all {dryRun.rows.length}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
