"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Loader2,
  Plus,
  Text,
  Image,
  Wand2,
  Trash2,
  ChevronUp,
  ChevronDown,
  ExternalLink,
  Globe,
  FileText,
  ArrowLeft,
  GripVertical,
  Layers,
  LayoutGrid,
  Palette,
  Eye,
  Link2,
  Upload,
  MousePointerClick,
  Minus,
  Code2,
  Copy,
  ClipboardPaste,
  Undo2,
  Redo2,
  Monitor,
  Tablet,
  Smartphone,
  FolderTree,
  MousePointer2,
  Star,
  Play,
  ChevronsDownUp,
  Grid3X3,
} from "lucide-react";
import {
  newBlockId,
  slugify,
  renderBlockHtml,
  renderTokenStyles,
  CMS_STYLES,
  THEME_PRESETS,
  ICON_NAMES,
  type CmsBlock,
  type CmsBlockStyle,
  type CmsPage,
} from "@/lib/cms";

type EditorTab = "pages" | "builder" | "submissions" | "site";

const PADDING_OPTS: { value: CmsBlockStyle["padding"]; label: string }[] = [
  { value: "none", label: "None" },
  { value: "sm", label: "S" },
  { value: "md", label: "M" },
  { value: "lg", label: "L" },
];

const WIDTH_OPTS: { value: CmsBlockStyle["width"]; label: string }[] = [
  { value: "full", label: "Full" },
  { value: "wide", label: "Wide" },
  { value: "half", label: "Half" },
  { value: "third", label: "Third" },
];

const ALIGN_OPTS: { value: CmsBlockStyle["align"]; label: string }[] = [
  { value: "left", label: "Left" },
  { value: "center", label: "Center" },
  { value: "right", label: "Right" },
];

export default function CmsPage() {
  const [tab, setTab] = useState<EditorTab>("pages");
  const [pages, setPages] = useState<CmsPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<CmsPage | null>(null);
  // Selection + edit history (undo/redo over every builder mutation).
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [historyPast, setHistoryPast] = useState<CmsBlock[][]>([]);
  const [historyFuture, setHistoryFuture] = useState<CmsBlock[][]>([]);
  // Preview viewport (desktop / tablet / mobile) + layer sidebar.
  const [previewWidth, setPreviewWidth] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const [layerOpen, setLayerOpen] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiBuilding, setAiBuilding] = useState(false);
  const [submissions, setSubmissions] = useState<any[]>([]);
  // Custom domains mapped to site pages
  const [domains, setDomains] = useState<{ id: string; domain: string; site_slug: string }[]>([]);
  const [newDomain, setNewDomain] = useState("");
  const [newDomainSlug, setNewDomainSlug] = useState("");
  const [domainMsg, setDomainMsg] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [domainBusy, setDomainBusy] = useState(false);
  // Drag-and-drop state
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dragOverSection, setDragOverSection] = useState<string | null>(null);
  const [styleOpen, setStyleOpen] = useState<string | null>(null);
  // Sitewide settings
  const [settings, setSettings] = useState<{
    site_name: string;
    tagline: string;
    logo_url: string;
    header_text: string;
    footer_text: string;
    site_nav: { label: string; href: string }[];
    global_css: string;
    theme_preset: string;
  }>({
    site_name: "My Site",
    tagline: "",
    logo_url: "",
    header_text: "",
    footer_text: "",
    site_nav: [],
    global_css: "",
    theme_preset: "clean",
  });
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const show = (type: "success" | "error", message: string) =>
    setFeedback({ type, message });

  // ------------------------------------------------------------------
  // Page list
  // ------------------------------------------------------------------
  const loadPages = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/cms/pages", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setPages(data.pages ?? []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPages();
  }, [loadPages]);

  // ------------------------------------------------------------------
  // Custom domains
  // ------------------------------------------------------------------
  const loadDomains = useCallback(async () => {
    try {
      const res = await fetch("/api/cms/domains", { credentials: "include" });
      if (res.ok) {
        const json = await res.json();
        setDomains(json.domains ?? []);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadDomains();
  }, [loadDomains]);

  const addDomain = async () => {
    const domain = newDomain.trim();
    const slug = newDomainSlug.trim();
    if (!domain || !slug) {
      setDomainMsg({ type: "error", message: "Enter a domain and choose a page." });
      return;
    }
    setDomainBusy(true);
    setDomainMsg(null);
    try {
      const res = await fetch("/api/cms/domains", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain, siteSlug: slug }),
      });
      const json = await res.json();
      if (!res.ok) {
        setDomainMsg({ type: "error", message: json.error ?? "Failed to add domain" });
        return;
      }
      setDomainMsg({ type: "success", message: `Mapped ${json.domain.domain} → /site/${json.domain.site_slug}` });
      setNewDomain("");
      loadDomains();
    } catch (err: any) {
      setDomainMsg({ type: "error", message: err.message ?? "Failed to add domain" });
    } finally {
      setDomainBusy(false);
    }
  };

  const removeDomain = async (id: string, domain: string) => {
    if (!confirm(`Unmap ${domain}?`)) return;
    const res = await fetch(`/api/cms/domains?id=${id}`, { method: "DELETE", credentials: "include" });
    if (res.ok) {
      setDomains((prev) => prev.filter((d) => d.id !== id));
      setDomainMsg({ type: "success", message: `Unmapped ${domain}.` });
    } else {
      const json = await res.json().catch(() => ({}));
      setDomainMsg({ type: "error", message: json.error ?? "Failed to remove domain" });
    }
  };

  const createPage = async () => {
    if (!newTitle.trim()) return;
    const res = await fetch("/api/cms/pages", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: newTitle.trim() }),
    });
    const data = await res.json();
    if (!res.ok) {
      show("error", data.error ?? "Failed to create page");
      return;
    }
    setNewTitle("");
    setPages((prev) => [data.page, ...prev]);
    openPage(data.page);
    show("success", "Page created.");
  };

  // ------------------------------------------------------------------
  // Builder
  // ------------------------------------------------------------------
  const openPage = (page: CmsPage) => {
    // Normalize blocks to an array — a NULL/string blocks column would
    // otherwise crash the builder with "Cannot read properties of
    // undefined (reading 'length')".
    setActive({ ...page, blocks: Array.isArray(page.blocks) ? page.blocks : [] });
    setTab("builder");
  };

  const closeBuilder = () => {
    setActive(null);
    loadPages();
  };

  const updateBlocks = async (blocks: CmsBlock[], then?: () => void) => {
    if (!active) return;
    const next = { ...active, blocks };
    setActive(next);
    // History: every mutation is pushed so Ctrl/Cmd+Z can step back.
    setHistoryPast((prev) => [...prev.slice(-49), active.blocks]);
    setHistoryFuture([]);
    setSaving(true);
    try {
      const res = await fetch(`/api/cms/pages/${active.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blocks }),
      });
      const data = await res.json();
      if (!res.ok) {
        show("error", data.error ?? "Failed to save");
        return;
      }
      then?.();
      refreshPreview(next);
    } finally {
      setSaving(false);
    }
  };

  const addTextBlock = () => {
    const block: CmsBlock = { id: newBlockId(), kind: "text", content: "## New section\n\nWrite your content here. **Bold**, *italic*, and [links](https://example.com) work." };
    updateBlocks([...(active?.blocks ?? []), block]);
  };

  const addImageBlock = () => {
    const block: CmsBlock = { id: newBlockId(), kind: "image", url: "", alt: "" };
    updateBlocks([...(active?.blocks ?? []), block]);
  };

  const addSection = () => {
    const block: CmsBlock = { id: newBlockId(), kind: "section", children: [] };
    updateBlocks([...(active?.blocks ?? []), block]);
  };

  const addColumns = (cols: number) => {
    const block: CmsBlock = { id: newBlockId(), kind: "columns", cols, children: [] };
    updateBlocks([...(active?.blocks ?? []), block]);
  };

  // --- Essential block types ------------------------------------------
  const addButton = () => {
    const block: CmsBlock = { id: newBlockId(), kind: "button", config: { label: "Get Started", href: "#", variant: "solid", size: "md" } };
    updateBlocks([...(active?.blocks ?? []), block]);
  };
  const addSpacer = () => {
    const block: CmsBlock = { id: newBlockId(), kind: "spacer", config: { height: 48 } };
    updateBlocks([...(active?.blocks ?? []), block]);
  };
  const addDivider = () => {
    const block: CmsBlock = { id: newBlockId(), kind: "divider", config: { style: "solid" } };
    updateBlocks([...(active?.blocks ?? []), block]);
  };
  const addEmbed = () => {
    const block: CmsBlock = { id: newBlockId(), kind: "embed", config: { html: "<!-- Paste HTML: scripts, widgets, shortcodes -->\n<p>Embedded content</p>" } };
    updateBlocks([...(active?.blocks ?? []), block]);
  };
  const addIcon = () => {
    const block: CmsBlock = { id: newBlockId(), kind: "icon", config: { name: "check", size: 24, color: "" }, style: { align: "center" } };
    updateBlocks([...(active?.blocks ?? []), block]);
  };
  const addVideo = () => {
    const block: CmsBlock = { id: newBlockId(), kind: "video", config: { url: "" } };
    updateBlocks([...(active?.blocks ?? []), block]);
  };
  const addAccordion = () => {
    const block: CmsBlock = {
      id: newBlockId(),
      kind: "accordion",
      config: { items: [{ title: "Question one?", body: "**Answer:** write the response here." }, { title: "Question two?", body: "**Answer:** write the response here." }] },
    };
    updateBlocks([...(active?.blocks ?? []), block]);
  };
  const addCards = () => {
    const block: CmsBlock = {
      id: newBlockId(),
      kind: "cards",
      config: { items: [{ title: "Card one", text: "Describe the value here.", buttonLabel: "Learn more", buttonHref: "#" }, { title: "Card two", text: "Describe the value here.", buttonLabel: "Learn more", buttonHref: "#" }, { title: "Card three", text: "Describe the value here.", buttonLabel: "Learn more", buttonHref: "#" }] },
    };
    updateBlocks([...(active?.blocks ?? []), block]);
  };

  // --- Undo / redo ----------------------------------------------------
  const undoBlocks = () => {
    if (!active || historyPast.length === 0) return;
    setHistoryFuture((prev) => [active.blocks, ...prev]);
    const prevBlocks = historyPast[historyPast.length - 1];
    setHistoryPast((prev) => prev.slice(0, -1));
    void updateBlocks(prevBlocks);
  };
  const redoBlocks = () => {
    if (!active || historyFuture.length === 0) return;
    setHistoryPast((prev) => [...prev, active.blocks]);
    const nextBlocks = historyFuture[0];
    setHistoryFuture((prev) => prev.slice(1));
    void updateBlocks(nextBlocks);
  };

  // Keyboard: Cmd/Ctrl+Z undo, Cmd/Ctrl+Shift+Z redo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!active) return;
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey && !typing) { e.preventDefault(); undoBlocks(); }
      else if (key === "z" && e.shiftKey && !typing) { e.preventDefault(); redoBlocks(); }
      else if (key === "y" && !typing) { e.preventDefault(); redoBlocks(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, historyPast, historyFuture]);

  // --- Copy / paste block ---------------------------------------------
  const copyBlock = async (b: CmsBlock) => {
    try {
      await navigator.clipboard.writeText(JSON.stringify({ type: "cms-block", block: b }));
      show("success", "Block copied — click Paste to insert a copy.");
    } catch {
      show("error", "Clipboard unavailable — select the block and copy again.");
    }
  };
  const pasteBlock = async () => {
    try {
      const raw = await navigator.clipboard.readText();
      const parsed = JSON.parse(raw);
      if (parsed?.type !== "cms-block" || !parsed.block?.kind) {
        show("error", "Clipboard has no copied block.");
        return;
      }
      const copy: CmsBlock = { ...(parsed.block as CmsBlock), id: newBlockId() };
      if (copy.children?.length) copy.children = copy.children.map((c) => ({ ...c, id: newBlockId() }));
      updateBlocks([...(active?.blocks ?? []), copy]);
      setSelectedId(copy.id);
    } catch {
      show("error", "Clipboard unavailable or not a block.");
    }
  };
  const duplicateBlock = (b: CmsBlock) => {
    const copy: CmsBlock = { ...b, id: newBlockId() };
    if (copy.children?.length) copy.children = copy.children.map((c) => ({ ...c, id: newBlockId() }));
    updateBlocks([...(active?.blocks ?? []), copy]);
    setSelectedId(copy.id);
  };

  // --- Insertable section templates ------------------------------------
  const TEMPLATES: { label: string; build: () => CmsBlock[] }[] = [
    {
      label: "Hero (headline + CTA)",
      build: () => [
        { id: newBlockId(), kind: "section", style: { padding: "lg", align: "center" }, children: [
          { id: newBlockId(), kind: "text", content: "# Your headline here\n\nA short supporting sentence that explains the value in one breath." },
          { id: newBlockId(), kind: "button", config: { label: "Get Started", href: "#", variant: "solid", size: "lg" } },
        ] },
      ],
    },
    {
      label: "Feature grid",
      build: () => [
        { id: newBlockId(), kind: "section", style: { padding: "md" }, children: [
          { id: newBlockId(), kind: "text", content: "## Why choose us" },
          { id: newBlockId(), kind: "cards", config: { items: [
            { title: "Fast", text: "Time to first value measured in minutes.", buttonLabel: "", buttonHref: "" },
            { title: "Simple", text: "No training required — everything just works.", buttonLabel: "", buttonHref: "" },
            { title: "Reliable", text: "Built for the long haul with support behind it.", buttonLabel: "", buttonHref: "" },
          ] } },
        ] },
      ],
    },
    {
      label: "Pricing table",
      build: () => [
        { id: newBlockId(), kind: "section", style: { padding: "md", align: "center" }, children: [
          { id: newBlockId(), kind: "text", content: "## Pricing" },
          { id: newBlockId(), kind: "cards", config: { items: [
            { title: "Starter", text: "**$29**/mo — everything to begin.", buttonLabel: "Start", buttonHref: "#" },
            { title: "Pro", text: "**$79**/mo — most popular.", buttonLabel: "Go Pro", buttonHref: "#" },
            { title: "Agency", text: "**$199**/mo — for teams.", buttonLabel: "Contact", buttonHref: "#" },
          ] } },
        ] },
      ],
    },
    {
      label: "CTA band",
      build: () => [
        { id: newBlockId(), kind: "section", style: { padding: "lg", align: "center", bg: "#1e293b", color: "#f8fafc" }, children: [
          { id: newBlockId(), kind: "text", content: "## Ready to start?\n\nJoin hundreds of teams shipping faster today." },
          { id: newBlockId(), kind: "button", config: { label: "Book a demo", href: "#", variant: "solid", size: "lg" } },
        ] },
      ],
    },
    {
      label: "FAQ accordion",
      build: () => [
        { id: newBlockId(), kind: "section", style: { padding: "md" }, children: [
          { id: newBlockId(), kind: "text", content: "## Frequently asked questions" },
          { id: newBlockId(), kind: "accordion", config: { items: [
            { title: "How fast is delivery?", body: "Most projects are live within a week." },
            { title: "Can I cancel anytime?", body: "Yes — no lock-in contracts." },
            { title: "Do you provide support?", body: "24/7 support is included on every plan." },
          ] } },
        ] },
      ],
    },
  ];
  const insertTemplate = (build: () => CmsBlock[]) => {
    updateBlocks([...(active?.blocks ?? []), ...build()]);
  };

  // --- Layer tree -------------------------------------------------------
  const blockLayerRows = (list: CmsBlock[], depth: number): React.ReactNode[] =>
    list.map((b) => [
      <button
        key={b.id}
        onClick={() => {
          setSelectedId(b.id);
          document.getElementById(`cms-block-${b.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
        }}
        className={`w-full flex items-center gap-1.5 px-2 py-1 rounded text-left text-[11px] transition-colors ${selectedId === b.id ? "bg-primary/10 text-primary" : "hover:bg-muted"}`}
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        {b.kind === "text" ? <Text className="size-3 shrink-0" /> : b.kind === "image" ? <Image className="size-3 shrink-0" /> : b.kind === "section" ? <Layers className="size-3 shrink-0" /> : b.kind === "columns" ? <LayoutGrid className="size-3 shrink-0" /> : b.kind === "button" ? <MousePointerClick className="size-3 shrink-0" /> : b.kind === "spacer" ? <Minus className="size-3 shrink-0" /> : b.kind === "divider" ? <Minus className="size-3 shrink-0" /> : b.kind === "embed" ? <Code2 className="size-3 shrink-0" /> : b.kind === "icon" ? <Star className="size-3 shrink-0" /> : b.kind === "video" ? <Play className="size-3 shrink-0" /> : b.kind === "accordion" ? <ChevronsDownUp className="size-3 shrink-0" /> : b.kind === "cards" ? <Grid3X3 className="size-3 shrink-0" /> : <Wand2 className="size-3 shrink-0" />}
        <span className="truncate">{blockTypeLabel(b)}</span>
      </button>,
      ...((b.kind === "section" || b.kind === "columns") && b.children?.length ? blockLayerRows(b.children, depth + 1) : []),
    ]);

  const updateConfig = (id: string, patch: Record<string, unknown>) => {
    if (!active) return;
    const mapBlocks = (list: CmsBlock[]): CmsBlock[] =>
      list.map((b) => {
        if (b.id === id) return { ...b, config: { ...(b.config ?? {}), ...patch } };
        if ((b.kind === "section" || b.kind === "columns") && b.children?.length) return { ...b, children: mapBlocks(b.children) };
        return b;
      });
    updateBlocks(mapBlocks(active.blocks));
  };

  const updateBlock = (id: string, patch: Partial<CmsBlock>) => {
    if (!active) return;
    const mapBlocks = (list: CmsBlock[]): CmsBlock[] =>
      list.map((b) => {
        if (b.id === id) return { ...b, ...patch };
        if ((b.kind === "section" || b.kind === "columns") && b.children?.length) return { ...b, children: mapBlocks(b.children) };
        return b;
      });
    updateBlocks(mapBlocks(active.blocks));
  };

  const removeBlock = (id: string) => {
    if (!active) return;
    const found = active.blocks.some((b) => b.id === id || ((b.kind === "section" || b.kind === "columns") && b.children?.some((c) => c.id === id)));
    if (!confirm(`Remove this ${found ? "block" : "block"}?`)) return;
    const filterBlocks = (list: CmsBlock[]): CmsBlock[] =>
      list
        .filter((b) => b.id !== id)
        .map((b) => ((b.kind === "section" || b.kind === "columns") && b.children?.length ? { ...b, children: b.children.filter((c) => c.id !== id) } : b));
    updateBlocks(filterBlocks(active.blocks));
  };

  const moveBlock = (index: number, dir: -1 | 1, list: CmsBlock[] = active?.blocks ?? []) => {
    const target = index + dir;
    if (target < 0 || target >= list.length) return;
    const next = [...list];
    [next[index], next[target]] = [next[target], next[index]];
    updateBlocks(next);
  };

  const moveChild = (sectionId: string, index: number, dir: -1 | 1) => {
    if (!active) return;
    const mapBlocks = (list: CmsBlock[]): CmsBlock[] =>
      list.map((b) => {
        if (b.id === sectionId && (b.kind === "section" || b.kind === "columns")) {
          const kids = [...(b.children ?? [])];
          const target = index + dir;
          if (target < 0 || target >= kids.length) return b;
          [kids[index], kids[target]] = [kids[target], kids[index]];
          return { ...b, children: kids };
        }
        return b;
      });
    updateBlocks(mapBlocks(active.blocks));
  };

  // --- Drag & drop ---------------------------------------------------
  // Move a block (from root or inside a section) to a root index or into a
  // section at an index. Returns the new block list, or null if unchanged.
  const relocateBlock = (
    dragId: string,
    target: { kind: "root"; index: number } | { kind: "section"; sectionId: string; index: number }
  ): CmsBlock[] | null => {
    if (!active) return null;
    let dragged: CmsBlock | null = null;
    const strip = (list: CmsBlock[]): CmsBlock[] => {
      const out: CmsBlock[] = [];
      for (const b of list) {
        if (b.id === dragId) {
          dragged = b;
          continue;
        }
        if ((b.kind === "section" || b.kind === "columns") && b.children?.length) {
          const kids = strip(b.children);
          out.push(kids.length !== b.children.length ? { ...b, children: kids } : b);
        } else {
          out.push(b);
        }
      }
      return out;
    };
    const next = strip(active.blocks);
    if (!dragged) return null;
    if (target.kind === "root") {
      const idx = Math.max(0, Math.min(target.index, next.length));
      next.splice(idx, 0, dragged);
      return next;
    }
    return next.map((b) =>
      b.id === target.sectionId
        ? { ...b, children: [...(b.children ?? []).slice(0, target.index), dragged!, ...(b.children ?? []).slice(target.index)] }
        : b
    );
  };

  const handleDrop = (target: { kind: "root"; index: number } | { kind: "section"; sectionId: string; index: number }) => {
    if (!dragId) return;
    const next = relocateBlock(dragId, target);
    setDragId(null);
    setDragOverId(null);
    setDragOverSection(null);
    if (next) updateBlocks(next);
  };

  // AI builds a custom block from a plain-language request.
  const buildAiBlock = async () => {
    if (!aiPrompt.trim()) return;
    setAiBuilding(true);
    try {
      const res = await fetch("/api/cms/ai-block", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: aiPrompt.trim(), pageTitle: active?.title }),
      });
      const data = await res.json();
      if (!res.ok) {
        show("error", data.error ?? "AI could not build that block");
        return;
      }
      updateBlocks([...(active?.blocks ?? []), data.block]);
      setAiPrompt("");
      show("success", `Built "${data.block.content ?? "AI block"}" — configure it if needed, then publish.`);
    } catch (err: any) {
      show("error", err.message ?? "AI block build failed");
    } finally {
      setAiBuilding(false);
    }
  };

  const togglePublish = async () => {
    if (!active) return;
    const res = await fetch(`/api/cms/pages/${active.id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_published: !active.is_published }),
    });
    const data = await res.json();
    if (!res.ok) {
      show("error", data.error ?? "Failed to update publish state");
      return;
    }
    setActive({ ...data.page, blocks: Array.isArray(data.page.blocks) ? data.page.blocks : [] });
    show("success", data.page.is_published ? "Page published 🎉" : "Page unpublished.");
  };

  const deletePage = async () => {
    if (!active) return;
    if (!confirm(`Delete page "${active.title}"? This cannot be undone.`)) return;
    const res = await fetch(`/api/cms/pages/${active.id}`, { method: "DELETE", credentials: "include" });
    if (res.ok) closeBuilder();
  };

  // Live preview iframe (builds HTML from blocks, same renderer as public).
  const refreshPreview = (page: CmsPage) => {
    const html = page.blocks.map((b) => renderBlockHtml(b, page.id)).join("\n");
    const tokens = page.tokens ? renderTokenStyles(page.tokens) : "";
    const doc = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${CMS_STYLES}${tokens}</style></head><body><div class="cms-shell">${html}</div></body></html>`;
    if (iframeRef.current) iframeRef.current.srcdoc = doc;
  };

  useEffect(() => {
    if (active && iframeRef.current) {
      const html = active.blocks.map((b) => renderBlockHtml(b, active.id)).join("\n");
      const tokens = active.tokens ? renderTokenStyles(active.tokens) : "";
      iframeRef.current.srcdoc = `<!DOCTYPE html><html><head><style>${CMS_STYLES}${tokens}</style></head><body><div class="cms-shell">${html}</div></body></html>`;
    }
  }, [active?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ------------------------------------------------------------------
  // Submissions
  // ------------------------------------------------------------------
  const loadSubmissions = useCallback(async () => {
    try {
      const res = await fetch("/api/cms/submissions", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setSubmissions(data.submissions ?? []);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (tab === "submissions") loadSubmissions();
  }, [tab, loadSubmissions]);

  // ------------------------------------------------------------------
  // Sitewide settings (header/footer + theme)
  // ------------------------------------------------------------------
  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/cms/settings", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        const s = data.settings ?? {};
        const headerBlocks = (s.header_blocks ?? []) as any[];
        const footerBlocks = (s.footer_blocks ?? []) as any[];
        setSettings({
          site_name: s.site_name ?? "My Site",
          tagline: s.tagline ?? "",
          logo_url: s.logo_url ?? "",
          header_text: headerBlocks.map((b) => b.content ?? "").join("\n\n"),
          footer_text: footerBlocks.map((b) => b.content ?? "").join("\n\n"),
          site_nav: Array.isArray(s.site_nav)
            ? (s.site_nav as { label: string; href: string }[]).filter((n) => n && n.label && n.href)
            : [],
          global_css: s.global_css ?? "",
          theme_preset: s.theme_preset ?? "clean",
        });
      }
    } catch {
      // ignore — defaults stay
    } finally {
      setSettingsLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (tab === "site" && !settingsLoaded) loadSettings();
  }, [tab, settingsLoaded, loadSettings]);

  const saveSettings = async () => {
    setSavingSettings(true);
    try {
      const toBlock = (text: string): any[] =>
        text
          .split(/\n{2,}/)
          .filter((p) => p.trim())
          .map((p) => ({ id: newBlockId(), kind: "text", content: p.trim() }));
      const res = await fetch("/api/cms/settings", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          site_name: settings.site_name,
          tagline: settings.tagline,
          logo_url: settings.logo_url || null,
          header_blocks: toBlock(settings.header_text),
          footer_blocks: toBlock(settings.footer_text),
          site_nav: settings.site_nav,
          global_css: settings.global_css,
          theme_preset: settings.theme_preset,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        show("error", data.error ?? "Failed to save site settings");
        return;
      }
      show("success", "Site settings saved — published pages update immediately.");
    } catch (err: any) {
      show("error", err.message ?? "Failed to save site settings");
    } finally {
      setSavingSettings(false);
    }
  };

  // ------------------------------------------------------------------
  // Block editor bits
  // ------------------------------------------------------------------
  const blockTypeIcon = (b: CmsBlock) =>
    b.kind === "text" ? <Text className="size-3" />
    : b.kind === "image" ? <Image className="size-3" />
    : b.kind === "section" ? <Layers className="size-3" />
    : b.kind === "columns" ? <LayoutGrid className="size-3" />
    : b.kind === "button" ? <MousePointerClick className="size-3" />
    : b.kind === "spacer" || b.kind === "divider" ? <Minus className="size-3" />
    : b.kind === "embed" ? <Code2 className="size-3" />
    : b.kind === "icon" ? <Star className="size-3" />
    : b.kind === "video" ? <Play className="size-3" />
    : b.kind === "accordion" ? <ChevronsDownUp className="size-3" />
    : b.kind === "cards" ? <Grid3X3 className="size-3" />
    : <Wand2 className="size-3" />;

  const blockTypeLabel = (b: CmsBlock) =>
    b.kind === "text" ? "Text"
    : b.kind === "image" ? "Image"
    : b.kind === "section" ? "Section"
    : b.kind === "columns" ? `Columns (${b.cols ?? 2})`
    : b.kind === "button" ? "Button"
    : b.kind === "spacer" ? "Spacer"
    : b.kind === "divider" ? "Divider"
    : b.kind === "embed" ? "Embed HTML"
    : b.kind === "icon" ? `Icon: ${String(b.config?.name ?? "check")}`
    : b.kind === "video" ? "Video"
    : b.kind === "accordion" ? `Accordion (${Array.isArray(b.config?.items) ? b.config.items.length : 0})`
    : b.kind === "cards" ? `Cards (${Array.isArray(b.config?.items) ? b.config.items.length : 0})`
    : `Widget: ${b.content ?? "AI"}`;

  const styleControls = (b: CmsBlock) => (
    <div className="mt-2 space-y-2 border-t pt-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground w-14">Padding</span>
        {PADDING_OPTS.map((o) => (
          <button key={o.value} onClick={() => updateBlock(b.id, { style: { ...b.style, padding: o.value } })}
            className={`px-1.5 py-0.5 rounded text-[11px] border ${b.style?.padding === o.value ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`}>
            {o.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground w-14">Width</span>
        {WIDTH_OPTS.map((o) => (
          <button key={o.value} onClick={() => updateBlock(b.id, { style: { ...b.style, width: o.value } })}
            className={`px-1.5 py-0.5 rounded text-[11px] border ${b.style?.width === o.value ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`}>
            {o.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground w-14">Align</span>
        {ALIGN_OPTS.map((o) => (
          <button key={o.value} onClick={() => updateBlock(b.id, { style: { ...b.style, align: o.value } })}
            className={`px-1.5 py-0.5 rounded text-[11px] border ${b.style?.align === o.value ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`}>
            {o.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          BG
          <input type="color" value={b.style?.bg ?? "#ffffff"} onChange={(e) => updateBlock(b.id, { style: { ...b.style, bg: e.target.value } })} className="size-6 rounded border cursor-pointer" />
        </label>
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          Text
          <input type="color" value={b.style?.color ?? "#1a1a1a"} onChange={(e) => updateBlock(b.id, { style: { ...b.style, color: e.target.value } })} className="size-6 rounded border cursor-pointer" />
        </label>
        {(b.style?.bg || b.style?.color) && (
          <button onClick={() => updateBlock(b.id, { style: { ...b.style, bg: undefined, color: undefined } })} className="text-[11px] underline text-muted-foreground">
            Clear colors
          </button>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground w-14">Hide on</span>
        {[
          { v: null as CmsBlockStyle["hideOn"], label: "Never" },
          { v: "mobile" as const, label: "Mobile" },
          { v: "tablet" as const, label: "Tablet" },
          { v: "desktop" as const, label: "Desktop" },
        ].map((o) => (
          <button key={String(o.v)} onClick={() => updateBlock(b.id, { style: { ...b.style, hideOn: o.v } })}
            className={`px-1.5 py-0.5 rounded text-[11px] border ${(b.style?.hideOn ?? null) === o.v ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`}>
            {o.label}
          </button>
        ))}
      </div>

      {b.kind === "image" && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground w-14">Wrap</span>
          {(["none", "left", "right"] as const).map((f) => (
            <button key={f} onClick={() => updateBlock(b.id, { style: { ...b.style, float: f } })}
              className={`px-1.5 py-0.5 rounded text-[11px] border ${(b.style?.float ?? "none") === f ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`}>
              {f === "none" ? "Inline" : f === "left" ? "Float left" : "Float right"}
            </button>
          ))}
        </div>
      )}

      {(b.kind === "section" || b.kind === "columns") && (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground w-14">Layout</span>
            {[
              { v: true, label: "Boxed" },
              { v: false, label: "Full width" },
            ].map((o) => (
              <button key={String(o.v)} onClick={() => updateBlock(b.id, { style: { ...b.style, boxed: o.v } })}
                className={`px-1.5 py-0.5 rounded text-[11px] border ${(b.style?.boxed ?? true) === o.v ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`}>
                {o.label}
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              BG image URL
              <input
                type="text"
                value={b.style?.bgImage ?? ""}
                onChange={(e) => updateBlock(b.id, { style: { ...b.style, bgImage: e.target.value || undefined } })}
                placeholder="https://…"
                className="flex-1 rounded border border-input bg-background px-2 py-1 text-xs"
              />
            </label>
            {b.kind === "section" && (
              <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                BG video URL
                <input
                  type="text"
                  value={b.style?.bgVideo ?? ""}
                  onChange={(e) => updateBlock(b.id, { style: { ...b.style, bgVideo: e.target.value || undefined } })}
                  placeholder="https://…/background.mp4"
                  className="flex-1 rounded border border-input bg-background px-2 py-1 text-xs"
                />
              </label>
            )}
            {(b.style?.bgImage || b.style?.bgVideo) && (
              <button onClick={() => updateBlock(b.id, { style: { ...b.style, bgImage: undefined, bgVideo: undefined } })} className="text-[11px] underline text-muted-foreground self-start">
                Clear backgrounds
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );

  // Insert a markdown fragment at the textarea cursor (toolbar helper).
  const wrapSelection = (b: CmsBlock, before: string, after: string, placeholder?: string) => {
    const ta = document.getElementById(`txt-${b.id}`) as HTMLTextAreaElement | null;
    if (!ta) return;
    const start = ta.selectionStart ?? (b.content ?? "").length;
    const end = ta.selectionEnd ?? start;
    const sel = (b.content ?? "").slice(start, end) || placeholder || "text";
    const next = (b.content ?? "").slice(0, start) + before + sel + after + (b.content ?? "").slice(end);
    updateBlock(b.id, { content: next });
    requestAnimationFrame(() => {
      ta.focus();
      const newPos = start + before.length + sel.length;
      ta.setSelectionRange(newPos, newPos);
    });
  };

  const TOOLBAR = [
    { label: "B", title: "Bold", fn: (b: CmsBlock) => wrapSelection(b, "**", "**") },
    { label: "I", title: "Italic", fn: (b: CmsBlock) => wrapSelection(b, "*", "*") },
    { label: "S", title: "Strikethrough", fn: (b: CmsBlock) => wrapSelection(b, "~~", "~~") },
    { label: "H2", title: "Heading 2", fn: (b: CmsBlock) => wrapSelection(b, "## ", "", "Heading") },
    { label: "H3", title: "Heading 3", fn: (b: CmsBlock) => wrapSelection(b, "### ", "", "Heading") },
    { label: "🔗", title: "Link", fn: (b: CmsBlock) => {
        const url = prompt("Link URL", "https://");
        if (url) wrapSelection(b, "[", `](${url})`, "link text");
      } },
    { label: "• List", title: "Bullet list", fn: (b: CmsBlock) => {
        const next = (b.content ?? "") + (b.content?.endsWith("\n") || !b.content ? "" : "\n") + "- item\n- item";
        updateBlock(b.id, { content: next });
      } },
  ];

  const blockContentEditor = (b: CmsBlock) => (
    <>
      {b.kind === "text" && (
        <div>
          <div className="flex items-center gap-1 mb-1.5 flex-wrap">
            {TOOLBAR.map((t) => (
              <button key={t.title} onClick={() => t.fn(b)} title={t.title}
                className="px-1.5 py-0.5 rounded border border-border text-xs font-semibold hover:bg-muted">
                {t.label}
              </button>
            ))}
            <span className="text-[10px] text-muted-foreground ml-auto">
              {b.html ? "HTML mode" : "Markdown · colors/fonts need HTML mode"}
            </span>
            <button onClick={() => updateBlock(b.id, { html: !b.html })}
              className={`px-1.5 py-0.5 rounded border text-[11px] ${b.html ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`}
              title="Toggle raw HTML editing">
              HTML
            </button>
          </div>
          <textarea
            id={`txt-${b.id}`}
            value={b.content ?? ""}
            onChange={(e) => updateBlock(b.id, { content: e.target.value })}
            rows={5}
            placeholder={b.html ? "<p>Write <strong>HTML</strong> directly…</p>" : "Write markdown: ## Heading, **bold**, [link](https://...)"}
            className={`w-full rounded-md border border-input bg-background px-3 py-2 text-sm ${b.html ? "font-mono" : ""}`}
          />
        </div>
      )}
      {b.kind === "image" && (
        <div className="space-y-2">
          <div className="flex gap-2 items-center">
            <Input placeholder="Image URL (paste a media URL)" value={b.url ?? ""}
              onChange={(e) => updateBlock(b.id, { url: e.target.value })} />
            <label className="shrink-0 inline-flex items-center gap-1 text-xs px-2 py-1.5 rounded-md border cursor-pointer hover:bg-muted">
              <Image className="size-3.5" /> Upload
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const fd = new FormData();
                  fd.append("file", f);
                  const res = await fetch("/api/cms/upload", { method: "POST", credentials: "include", body: fd });
                  const data = await res.json().catch(() => ({}));
                  if (!res.ok) {
                    show("error", data.error ?? "Upload failed");
                    return;
                  }
                  updateBlock(b.id, { url: data.url, alt: b.alt || data.alt || "" });
                  show("success", "Image uploaded.");
                }}
              />
            </label>
          </div>
          <Input placeholder="Alt text (SEO)" value={b.alt ?? ""}
            onChange={(e) => updateBlock(b.id, { alt: e.target.value })} />
          {b.url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={b.url} alt={b.alt ?? ""} className="max-h-40 rounded-md border" />
          )}
        </div>
      )}
      {b.kind === "custom" && b.custom === "form" && (
        <div className="space-y-2">
          <Input placeholder="Fields, comma separated (name, email, message)" defaultValue={((b.config?.fields as string[]) ?? []).join(", ")}
            onBlur={(e) => updateBlock(b.id, { config: { ...b.config, fields: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) } })} />
          <Input placeholder="Button text" defaultValue={String(b.config?.buttonText ?? "Submit")}
            onBlur={(e) => updateBlock(b.id, { config: { ...b.config, buttonText: e.target.value } })} />
          <Input placeholder="Where should submissions go? (email — e.g. hello@mysite.com)" defaultValue={String(b.config?.destination_email ?? "")}
            onBlur={(e) => updateBlock(b.id, { config: { ...b.config, destination_email: e.target.value } })} />
          <Input placeholder="Email subject (e.g. New website enquiry)" defaultValue={String(b.config?.email_subject ?? "")}
            onBlur={(e) => updateBlock(b.id, { config: { ...b.config, email_subject: e.target.value } })} />
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={b.config?.newsletter === true}
              onChange={(e) => updateBlock(b.id, { config: { ...b.config, newsletter: e.target.checked } })}
              className="size-3.5"
            />
            This is a newsletter / subscription form (collect consent on submit)
          </label>
          <p className="text-[11px] text-muted-foreground">
            Submissions are always stored here; email delivery needs your SMTP/Resend key configured.
          </p>
        </div>
      )}
      {b.kind === "custom" && (b.custom === "map" || b.custom === "youtube" || b.custom === "instagram" || b.custom === "embed") && (
        <div className="space-y-2">
          {b.custom === "map" && (
            <Input placeholder="Map query (e.g., Toronto, Ontario)" defaultValue={String(b.config?.query ?? "")}
              onBlur={(e) => updateBlock(b.id, { config: { ...b.config, query: e.target.value } })} />
          )}
          {(b.custom === "youtube" || b.custom === "instagram" || b.custom === "embed") && (
            <Input placeholder={b.custom === "embed" ? "https:// URL to embed" : b.custom === "instagram" ? "https://www.instagram.com/p/..." : "https://www.youtube.com/watch?v=..."}
              defaultValue={String(b.config?.url ?? b.config?.src ?? "")}
              onBlur={(e) => updateBlock(b.id, { config: { ...b.config, [b.custom === "embed" ? "src" : "url"]: e.target.value } })} />
          )}
        </div>
      )}
      {b.kind === "custom" && b.custom === "ai" && (
        <textarea value={String(b.config?.content ?? "")} onChange={(e) => updateBlock(b.id, { config: { ...b.config, content: e.target.value } })}
          rows={3} placeholder="Block summary / note" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
      )}

      {/* --- Essential block types --- */}
      {b.kind === "button" && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="Label" defaultValue={String(b.config?.label ?? "")} onBlur={(e) => updateConfig(b.id, { label: e.target.value })} />
            <Input placeholder="Link (https://… or #)" defaultValue={String(b.config?.href ?? "")} onBlur={(e) => updateConfig(b.id, { href: e.target.value })} />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {["solid", "outline", "ghost"].map((v) => (
              <button key={v} onClick={() => updateConfig(b.id, { variant: v })}
                className={`px-1.5 py-0.5 rounded text-[11px] border capitalize ${b.config?.variant === v ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`}>
                {v}
              </button>
            ))}
            {["sm", "md", "lg"].map((v) => (
              <button key={v} onClick={() => updateConfig(b.id, { size: v })}
                className={`px-1.5 py-0.5 rounded text-[11px] border uppercase ${b.config?.size === v ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`}>
                {v}
              </button>
            ))}
          </div>
        </div>
      )}
      {b.kind === "spacer" && (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
            Height (px)
            <input type="number" min={0} max={500} value={Number(b.config?.height ?? 48)}
              onChange={(e) => updateConfig(b.id, { height: Number(e.target.value) })}
              className="w-20 rounded border border-input bg-background px-2 py-1 text-xs" />
          </label>
        </div>
      )}
      {b.kind === "divider" && (
        <div className="flex items-center gap-2 flex-wrap">
          {["solid", "dashed", "dotted"].map((v) => (
            <button key={v} onClick={() => updateConfig(b.id, { style: v })}
              className={`px-1.5 py-0.5 rounded text-[11px] border capitalize ${b.config?.style === v ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`}>
              {v}
            </button>
          ))}
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground ml-2">
            Color
            <input type="color" value={String(b.config?.color ?? "#d1d5db")} onChange={(e) => updateConfig(b.id, { color: e.target.value })} className="size-6 rounded border cursor-pointer" />
          </label>
        </div>
      )}
      {b.kind === "embed" && (
        <div className="space-y-1.5">
          <textarea
            value={String(b.config?.html ?? "")}
            onChange={(e) => updateConfig(b.id, { html: e.target.value })}
            rows={6}
            placeholder="Paste raw HTML — scripts, widgets, shortcodes, third-party embeds…"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
          />
          <p className="text-[11px] text-muted-foreground">
            Rendered as-is on the public site (tenant-authorized, like WordPress shortcodes).
          </p>
        </div>
      )}
      {b.kind === "icon" && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1">
            {ICON_NAMES.map((n) => (
              <button key={n} onClick={() => updateConfig(b.id, { name: n })}
                className={`px-1.5 py-0.5 rounded text-[10px] border ${b.config?.name === n ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`}>
                {n}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              Size
              <input type="number" min={12} max={96} value={Number(b.config?.size ?? 24)}
                onChange={(e) => updateConfig(b.id, { size: Number(e.target.value) })}
                className="w-16 rounded border border-input bg-background px-2 py-1 text-xs" />
            </label>
            <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              Color
              <input type="color" value={String(b.config?.color ?? "#2563eb")} onChange={(e) => updateConfig(b.id, { color: e.target.value })} className="size-6 rounded border cursor-pointer" />
            </label>
          </div>
        </div>
      )}
      {b.kind === "video" && (
        <div className="space-y-1.5">
          <Input placeholder="YouTube, Vimeo, or direct .mp4/.webm URL" defaultValue={String(b.config?.url ?? "")}
            onBlur={(e) => updateConfig(b.id, { url: e.target.value })} />
          <p className="text-[11px] text-muted-foreground">Auto-detected: YouTube / Vimeo embeds, or self-hosted video players.</p>
        </div>
      )}
      {b.kind === "accordion" && (
        <div className="space-y-2">
          {Array.isArray(b.config?.items) &&
            (b.config.items as { title?: string; body?: string }[]).map((item, i) => (
              <div key={i} className="space-y-1 rounded border border-border p-2">
                <Input placeholder="Question" value={item.title ?? ""}
                  onChange={(e) => {
                    const items = [...(b.config?.items as { title?: string; body?: string }[])];
                    items[i] = { ...items[i], title: e.target.value };
                    updateConfig(b.id, { items });
                  }} />
                <textarea placeholder="Answer (markdown supported)" rows={2} value={item.body ?? ""}
                  onChange={(e) => {
                    const items = [...(b.config?.items as { title?: string; body?: string }[])];
                    items[i] = { ...items[i], body: e.target.value };
                    updateConfig(b.id, { items });
                  }}
                  className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs" />
                <button onClick={() => updateConfig(b.id, { items: (b.config?.items as unknown[]).filter((_, x) => x !== i) })}
                  className="text-[10px] text-red-500 underline">
                  Remove item
                </button>
              </div>
            ))}
          <Button variant="ghost" size="sm" onClick={() => updateConfig(b.id, { items: [...(Array.isArray(b.config?.items) ? (b.config.items as { title?: string; body?: string }[]) : []), { title: "New question?", body: "Answer here." }] })}>
            <Plus className="size-3 mr-1" /> Add item
          </Button>
        </div>
      )}
      {b.kind === "cards" && (
        <div className="space-y-2">
          {Array.isArray(b.config?.items) &&
            (b.config.items as { title?: string; text?: string; buttonLabel?: string; buttonHref?: string; image?: string }[]).map((item, i) => (
              <div key={i} className="space-y-1 rounded border border-border p-2">
                <div className="grid grid-cols-2 gap-1.5">
                  <Input placeholder="Title" value={item.title ?? ""}
                    onChange={(e) => {
                      const items = [...(b.config?.items as typeof item[])];
                      items[i] = { ...items[i], title: e.target.value };
                      updateConfig(b.id, { items });
                    }} />
                  <Input placeholder="Image URL (optional)" value={item.image ?? ""}
                    onChange={(e) => {
                      const items = [...(b.config?.items as typeof item[])];
                      items[i] = { ...items[i], image: e.target.value };
                      updateConfig(b.id, { items });
                    }} />
                </div>
                <textarea placeholder="Description" rows={2} value={item.text ?? ""}
                  onChange={(e) => {
                    const items = [...(b.config?.items as typeof item[])];
                    items[i] = { ...items[i], text: e.target.value };
                    updateConfig(b.id, { items });
                  }}
                  className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs" />
                <div className="grid grid-cols-2 gap-1.5">
                  <Input placeholder="Button label" value={item.buttonLabel ?? ""}
                    onChange={(e) => {
                      const items = [...(b.config?.items as typeof item[])];
                      items[i] = { ...items[i], buttonLabel: e.target.value };
                      updateConfig(b.id, { items });
                    }} />
                  <Input placeholder="Button link" value={item.buttonHref ?? ""}
                    onChange={(e) => {
                      const items = [...(b.config?.items as typeof item[])];
                      items[i] = { ...items[i], buttonHref: e.target.value };
                      updateConfig(b.id, { items });
                    }} />
                </div>
                <button onClick={() => updateConfig(b.id, { items: (b.config?.items as unknown[]).filter((_, x) => x !== i) })}
                  className="text-[10px] text-red-500 underline">
                  Remove card
                </button>
              </div>
            ))}
          <Button variant="ghost" size="sm" onClick={() => updateConfig(b.id, { items: [...(Array.isArray(b.config?.items) ? (b.config.items as unknown[]) : []), { title: "New card", text: "Describe the value.", buttonLabel: "Learn more", buttonHref: "#" }] })}>
            <Plus className="size-3 mr-1" /> Add card
          </Button>
        </div>
      )}
    </>
  );

  // Single card for a non-section block (root or inside a section).
  const blockCard = (b: CmsBlock, index: number, listLength: number, sectionId?: string, moveFn?: (dir: -1 | 1) => void) => (
    <Card key={b.id}
      id={`cms-block-${b.id}`}
      draggable
      onClick={() => setSelectedId(b.id)}
      onDragStart={(e) => { setDragId(b.id); e.dataTransfer.effectAllowed = "move"; }}
      onDragOver={(e) => { e.preventDefault(); setDragOverId(b.id); }}
      onDragLeave={() => setDragOverId((cur) => (cur === b.id ? null : cur))}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); handleDrop(sectionId ? { kind: "section", sectionId, index } : { kind: "root", index }); }}
      className={`p-3 cursor-grab active:cursor-grabbing ${dragOverId === b.id && dragId !== b.id ? "ring-2 ring-primary" : selectedId === b.id ? "ring-2 ring-primary/60" : ""}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
          <GripVertical className="size-3.5" /> {blockTypeIcon(b)} {blockTypeLabel(b)}
        </span>
        <div className="flex items-center gap-0.5">
          <button onClick={() => copyBlock(b)} className="p-1 rounded hover:bg-muted" title="Copy block (styles + content)"><Copy className="size-3.5" /></button>
          <button onClick={() => duplicateBlock(b)} className="p-1 rounded hover:bg-muted" title="Duplicate block"><Plus className="size-3.5" /></button>
          <button onClick={() => (moveFn ? moveFn(-1) : moveBlock(index, -1))} disabled={index === 0} className="p-1 rounded hover:bg-muted disabled:opacity-30" title="Move up"><ChevronUp className="size-3.5" /></button>
          <button onClick={() => (moveFn ? moveFn(1) : moveBlock(index, 1))} disabled={index === listLength - 1} className="p-1 rounded hover:bg-muted disabled:opacity-30" title="Move down"><ChevronDown className="size-3.5" /></button>
          <button onClick={() => setStyleOpen(styleOpen === b.id ? null : b.id)} className={`p-1 rounded hover:bg-muted ${styleOpen === b.id ? "bg-muted" : ""}`} title="Style"><Palette className="size-3.5" /></button>
          <button onClick={() => removeBlock(b.id)} className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900 text-red-500" title="Remove"><Trash2 className="size-3.5" /></button>
        </div>
      </div>
      {blockContentEditor(b)}
      {styleOpen === b.id && styleControls(b)}
    </Card>
  );

  // Section card: container with a drop zone; children render inside.
  const sectionCard = (b: CmsBlock, index: number, listLength: number) => (
    <Card key={b.id}
      draggable
      onDragStart={(e) => { setDragId(b.id); e.dataTransfer.effectAllowed = "move"; }}
      onDragOver={(e) => { e.preventDefault(); setDragOverId(b.id); }}
      onDragLeave={() => setDragOverId((cur) => (cur === b.id ? null : cur))}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); handleDrop({ kind: "root", index }); }}
      className={`p-3 ${dragOverId === b.id && dragId !== b.id ? "ring-2 ring-primary" : ""}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
          <GripVertical className="size-3.5" /> <Layers className="size-3" /> Section
        </span>
        <div className="flex items-center gap-0.5">
          <button onClick={() => moveBlock(index, -1)} disabled={index === 0} className="p-1 rounded hover:bg-muted disabled:opacity-30" title="Move up"><ChevronUp className="size-3.5" /></button>
          <button onClick={() => moveBlock(index, 1)} disabled={index === listLength - 1} className="p-1 rounded hover:bg-muted disabled:opacity-30" title="Move down"><ChevronDown className="size-3.5" /></button>
          <button onClick={() => setStyleOpen(styleOpen === b.id ? null : b.id)} className={`p-1 rounded hover:bg-muted ${styleOpen === b.id ? "bg-muted" : ""}`} title="Style"><Palette className="size-3.5" /></button>
          <button onClick={() => removeBlock(b.id)} className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900 text-red-500" title="Remove section and its blocks"><Trash2 className="size-3.5" /></button>
        </div>
      </div>
      {styleOpen === b.id && styleControls(b)}
      <div className={`rounded-lg border border-dashed p-2 space-y-2 ${dragOverSection === b.id ? "bg-primary/5 ring-1 ring-primary" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragOverSection(b.id); }}
        onDragLeave={() => setDragOverSection((cur) => (cur === b.id ? null : cur))}
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); handleDrop({ kind: "section", sectionId: b.id, index: b.children?.length ?? 0 }); }}>
        {(b.children ?? []).map((child, ci) => (
          <div key={child.id} className="relative"
            onDragOver={(e) => { e.preventDefault(); setDragOverId(child.id); }}
            onDragLeave={() => setDragOverId((cur) => (cur === child.id ? null : cur))}
            onDrop={(e) => { e.preventDefault(); e.stopPropagation(); handleDrop({ kind: "section", sectionId: b.id, index: ci }); }}>
            {blockCard(child, ci, b.children?.length ?? 0, b.id, (dir) => moveChild(b.id, ci, dir))}
          </div>
        ))}
        {(b.children ?? []).length === 0 && (
          <p className="text-[11px] text-center text-muted-foreground py-4">
            Drop blocks here, or use Add Block below.
          </p>
        )}
      </div>
      <div className="flex gap-2 mt-2 flex-wrap">
        <Button variant="ghost" size="sm" onClick={() => {
          const child: CmsBlock = { id: newBlockId(), kind: "text", content: "## Inside section" };
          updateBlock(b.id, { children: [...(b.children ?? []), child] });
        }}><Plus className="size-3 mr-1" /> Text</Button>
        <Button variant="ghost" size="sm" onClick={() => {
          const child: CmsBlock = { id: newBlockId(), kind: "image", url: "", alt: "" };
          updateBlock(b.id, { children: [...(b.children ?? []), child] });
        }}><Plus className="size-3 mr-1" /> Image</Button>
      </div>
    </Card>
  );

  // Columns card: children flow left→right across N columns (2/3/4), wrapping
  // into rows. Responsive: collapses to one column on small screens.
  const columnsCard = (b: CmsBlock, index: number, listLength: number) => {
    const cols = [2, 3, 4].includes(b.cols ?? 2) ? (b.cols as number) : 2;
    const children = b.children ?? [];
    return (
      <Card key={b.id}
        draggable
        onDragStart={(e) => { setDragId(b.id); e.dataTransfer.effectAllowed = "move"; }}
        onDragOver={(e) => { e.preventDefault(); setDragOverId(b.id); }}
        onDragLeave={() => setDragOverId((cur) => (cur === b.id ? null : cur))}
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); handleDrop({ kind: "root", index }); }}
        className={`p-3 ${dragOverId === b.id && dragId !== b.id ? "ring-2 ring-primary" : ""}`}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
            <GripVertical className="size-3.5" /> <LayoutGrid className="size-3" /> Columns
          </span>
          <div className="flex items-center gap-0.5">
            <span className="text-[10px] text-muted-foreground mr-1">Cols</span>
            {[2, 3, 4].map((c) => (
              <button key={c} onClick={() => updateBlock(b.id, { cols: c })}
                className={`px-1.5 py-0.5 rounded text-[11px] border ${cols === c ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`}>
                {c}
              </button>
            ))}
            <button onClick={() => moveBlock(index, -1)} disabled={index === 0} className="p-1 rounded hover:bg-muted disabled:opacity-30" title="Move up"><ChevronUp className="size-3.5" /></button>
            <button onClick={() => moveBlock(index, 1)} disabled={index === listLength - 1} className="p-1 rounded hover:bg-muted disabled:opacity-30" title="Move down"><ChevronDown className="size-3.5" /></button>
            <button onClick={() => setStyleOpen(styleOpen === b.id ? null : b.id)} className={`p-1 rounded hover:bg-muted ${styleOpen === b.id ? "bg-muted" : ""}`} title="Style"><Palette className="size-3.5" /></button>
            <button onClick={() => removeBlock(b.id)} className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900 text-red-500" title="Remove columns and their blocks"><Trash2 className="size-3.5" /></button>
          </div>
        </div>
        {styleOpen === b.id && styleControls(b)}
        <div
          className={`rounded-lg border border-dashed p-2 grid gap-2 ${
            cols === 2 ? "grid-cols-2" : cols === 3 ? "grid-cols-3" : "grid-cols-4"
          } max-sm:grid-cols-1 ${dragOverSection === b.id ? "bg-primary/5 ring-1 ring-primary" : ""}`}
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
          onDragOver={(e) => { e.preventDefault(); setDragOverSection(b.id); }}
          onDragLeave={() => setDragOverSection((cur) => (cur === b.id ? null : cur))}
          onDrop={(e) => { e.preventDefault(); e.stopPropagation(); handleDrop({ kind: "section", sectionId: b.id, index: children.length }); }}>
          {children.map((child, ci) => (
            <div key={child.id} className="relative min-w-0"
              onDragOver={(e) => { e.preventDefault(); setDragOverId(child.id); }}
              onDragLeave={() => setDragOverId((cur) => (cur === child.id ? null : cur))}
              onDrop={(e) => { e.preventDefault(); e.stopPropagation(); handleDrop({ kind: "section", sectionId: b.id, index: ci }); }}>
              {blockCard(child, ci, children.length, b.id, (dir) => moveChild(b.id, ci, dir))}
            </div>
          ))}
          {children.length === 0 && (
            <div className="col-span-full">
              <p className="text-[11px] text-center text-muted-foreground py-4">
                Drop blocks here, or use Add Block below. Items flow left → right into {cols} columns.
              </p>
            </div>
          )}
        </div>
        <div className="flex gap-2 mt-2 flex-wrap">
          <Button variant="ghost" size="sm" onClick={() => {
            const child: CmsBlock = { id: newBlockId(), kind: "text", content: "## Column text" };
            updateBlock(b.id, { children: [...children, child] });
          }}><Plus className="size-3 mr-1" /> Text</Button>
          <Button variant="ghost" size="sm" onClick={() => {
            const child: CmsBlock = { id: newBlockId(), kind: "image", url: "", alt: "" };
            updateBlock(b.id, { children: [...children, child] });
          }}><Plus className="size-3 mr-1" /> Image</Button>
        </div>
      </Card>
    );
  };

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Website Builder</h1>
        <p className="text-muted-foreground mt-1">
          Build client websites visually with blocks — text, images, sections, or ask the
          AI to build a custom widget (forms, maps, embeds). Publish to /site/&lt;slug&gt;.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b pb-2">
        <button onClick={() => setTab("pages")}
          className={`text-sm font-medium px-3 py-1.5 rounded-t-md ${tab === "pages" ? "bg-muted" : "text-muted-foreground"}`}>
          <Globe className="size-3 inline mr-1" /> Pages ({pages.length})
        </button>
        <button onClick={() => setTab("builder")} disabled={!active}
          className={`text-sm font-medium px-3 py-1.5 rounded-t-md ${tab === "builder" ? "bg-muted" : "text-muted-foreground"} ${!active ? "opacity-40" : ""}`}>
          <FileText className="size-3 inline mr-1" /> Builder
        </button>
        <button onClick={() => setTab("submissions")}
          className={`text-sm font-medium px-3 py-1.5 rounded-t-md ${tab === "submissions" ? "bg-muted" : "text-muted-foreground"}`}>
          <FileText className="size-3 inline mr-1" /> Form Submissions ({submissions.length})
        </button>
        <button onClick={() => setTab("site")}
          className={`text-sm font-medium px-3 py-1.5 rounded-t-md ${tab === "site" ? "bg-muted" : "text-muted-foreground"}`}>
          <Globe className="size-3 inline mr-1" /> Site Settings
        </button>
      </div>

      {feedback && (
        <div className={`p-3 rounded-md text-sm border ${feedback.type === "success" ? "bg-green-50 text-green-700 border-green-200" : "bg-red-50 text-red-700 border-red-200"}`} role="alert">
          {feedback.message}
          <button className="ml-3 underline text-xs" onClick={() => setFeedback(null)}>Dismiss</button>
        </div>
      )}

      {/* ============ PAGES ============ */}
      {tab === "pages" && (
        <Card className="p-6">
          <h2 className="text-lg font-semibold mb-4">Your Pages</h2>
          <div className="flex gap-2 mb-4">
            <Input placeholder="New page title (e.g., Home, Services, Contact)" value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && createPage()} />
            <Button onClick={createPage} disabled={!newTitle.trim()}>
              <Plus className="size-4 mr-1" /> Create
            </Button>
          </div>
          {loading ? (
            <div className="flex justify-center py-10"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
          ) : pages.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No pages yet — create your first page above.</p>
          ) : (
            <div className="space-y-2">
              {pages.map((p) => (
                <div key={p.id} className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/30 cursor-pointer"
                  onClick={() => openPage(p)}>
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{p.title}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-muted-foreground">/{p.slug}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full capitalize ${p.is_published ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>
                        {p.is_published ? "Published" : "Draft"}
                      </span>
                      <span className="text-xs text-muted-foreground">{p.blocks?.length ?? 0} blocks</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {p.is_published ? (
                      <a href={`/site/${p.slug}`} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()}
                        className="text-primary hover:underline text-xs inline-flex items-center gap-1">
                        <ExternalLink className="size-3" /> View
                      </a>
                    ) : p.preview_token ? (
                      <a href={`/site/${p.slug}?preview=${p.preview_token}`} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()}
                        className="text-muted-foreground hover:text-primary hover:underline text-xs inline-flex items-center gap-1"
                        title="Secret draft-preview link — share with the client to review before publishing">
                        <Eye className="size-3" /> Preview
                      </a>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* ============ BUILDER ============ */}
      {tab === "builder" && active && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: block canvas */}
          <div className="space-y-4">
            <Card className="p-4">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 min-w-0">
                  <Button variant="ghost" size="sm" onClick={closeBuilder}><ArrowLeft className="size-4" /></Button>
                  <Input value={active.title}
                    onChange={(e) => {
                      const t = e.target.value;
                      setActive((prev) => prev ? { ...prev, title: t, slug: slugify(t) } : prev);
                    }}
                    onBlur={async () => {
                      if (!active) return;
                      await fetch(`/api/cms/pages/${active.id}`, {
                        method: "PATCH", credentials: "include",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ title: active.title, slug: active.slug }),
                      });
                    }}
                    className="font-semibold w-48" />
                </div>
                <div className="flex items-center gap-2">
                  <Button variant={active.is_published ? "secondary" : "default"} size="sm" onClick={togglePublish}>
                    {active.is_published ? "Unpublish" : "Publish"}
                  </Button>
                  <Button variant="ghost" size="sm" className="text-destructive" onClick={deletePage}><Trash2 className="size-3.5" /></Button>
                </div>
              </div>
              <div className="flex items-center gap-3 mt-2 flex-wrap">
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  Kind
                  <select
                    value={active.kind ?? "page"}
                    onChange={(e) => {
                      const kind = e.target.value as "page" | "blog_archive" | "blog_post";
                      const next = { ...active, kind };
                      setActive(next);
                      fetch(`/api/cms/pages/${active.id}`, {
                        method: "PATCH", credentials: "include",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ kind }),
                      }).catch(() => {});
                    }}
                    className="rounded-md border border-input bg-background px-2 py-1 text-xs"
                  >
                    <option value="page">Page</option>
                    <option value="blog_archive">Blog archive</option>
                    <option value="blog_post">Blog post</option>
                  </select>
                </label>
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  Category
                  <input
                    value={active.category ?? ""}
                    onChange={(e) => setActive((prev) => (prev ? { ...prev, category: e.target.value } : prev))}
                    onBlur={async () => {
                      if (!active) return;
                      await fetch(`/api/cms/pages/${active.id}`, {
                        method: "PATCH", credentials: "include",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ category: active.category }),
                      }).catch(() => {});
                    }}
                    placeholder="e.g. services, company news"
                    className="rounded-md border border-input bg-background px-2 py-1 text-xs w-44"
                  />
                </label>
                <span className="text-[10px] text-muted-foreground">
                  Archive pages list published blog posts with this category grouping.
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Live at <a href={`/site/${active.slug}`} target="_blank" rel="noopener" className="text-primary underline">/site/{active.slug}</a>
                {saving && <Loader2 className="size-3 animate-spin inline ml-2" />}
              </p>
            </Card>

            {/* Add-block toolbar */}
            <div className="space-y-2">
              <div className="flex gap-2 flex-wrap items-center">
                <Button variant="outline" size="sm" onClick={addTextBlock}><Text className="size-3.5 mr-1" /> Text</Button>
                <Button variant="outline" size="sm" onClick={addImageBlock}><Image className="size-3.5 mr-1" /> Image</Button>
                <Button variant="outline" size="sm" onClick={addSection}><Layers className="size-3.5 mr-1" /> Section</Button>
                <Button variant="outline" size="sm" onClick={() => addColumns(2)} title="2, 3 or 4 columns — switch with the Columns buttons"><LayoutGrid className="size-3.5 mr-1" /> Columns</Button>
                <Button variant="outline" size="sm" onClick={addButton}><MousePointerClick className="size-3.5 mr-1" /> Button</Button>
                <Button variant="outline" size="sm" onClick={addCards}><Grid3X3 className="size-3.5 mr-1" /> Cards</Button>
                <Button variant="outline" size="sm" onClick={addVideo}><Play className="size-3.5 mr-1" /> Video</Button>
                <Button variant="outline" size="sm" onClick={addAccordion}><ChevronsDownUp className="size-3.5 mr-1" /> Accordion</Button>
                <Button variant="outline" size="sm" onClick={addIcon}><Star className="size-3.5 mr-1" /> Icon</Button>
                <Button variant="outline" size="sm" onClick={addSpacer}><Minus className="size-3.5 mr-1" /> Spacer</Button>
                <Button variant="outline" size="sm" onClick={addDivider}><Minus className="size-3.5 mr-1" /> Divider</Button>
                <Button variant="outline" size="sm" onClick={addEmbed}><Code2 className="size-3.5 mr-1" /> Embed HTML</Button>
              </div>
              <div className="flex gap-2 flex-wrap items-center">
                <select
                  value=""
                  onChange={(e) => {
                    const t = TEMPLATES.find((x) => x.label === e.target.value);
                    if (t) insertTemplate(t.build);
                  }}
                  className="rounded-md border border-input bg-background px-2 py-1.5 text-xs h-8"
                  title="Insert a pre-built section template"
                >
                  <option value="">Insert template…</option>
                  {TEMPLATES.map((t) => (
                    <option key={t.label} value={t.label}>{t.label}</option>
                  ))}
                </select>
                <Button variant="ghost" size="sm" onClick={undoBlocks} disabled={historyPast.length === 0} title="Undo (Ctrl+Z)"><Undo2 className="size-3.5" /></Button>
                <Button variant="ghost" size="sm" onClick={redoBlocks} disabled={historyFuture.length === 0} title="Redo (Ctrl+Shift+Z)"><Redo2 className="size-3.5" /></Button>
                <Button variant="ghost" size="sm" onClick={pasteBlock} title="Paste a copied block"><ClipboardPaste className="size-3.5" /></Button>
                <Button variant={layerOpen ? "default" : "outline"} size="sm" onClick={() => setLayerOpen((v) => !v)} title="Layer manager (tree view)">
                  <FolderTree className="size-3.5 mr-1" /> Layers
                </Button>
                <div className="flex items-center gap-0.5 border rounded-md px-1 py-0.5 ml-auto">
                  {([["desktop", <Monitor key="d" className="size-3.5" />], ["tablet", <Tablet key="t" className="size-3.5" />], ["mobile", <Smartphone key="m" className="size-3.5" />]] as const).map(([w, icon]) => (
                    <button key={w} onClick={() => setPreviewWidth(w)}
                      className={`p-1 rounded ${previewWidth === w ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"}`}
                      title={`Preview: ${w}`}>
                      {icon}
                    </button>
                  ))}
                </div>
                <div className="flex-1 min-w-[220px] flex gap-2">
                  <Input placeholder="Ask AI to build a block — e.g. 'a contact form', 'an interactive map', 'a YouTube embedder', 'an Instagram gallery embedder'"
                    value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && buildAiBlock()} />
                  <Button size="sm" onClick={buildAiBlock} disabled={aiBuilding || !aiPrompt.trim()} title="Build this block with AI">
                    {aiBuilding ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
                  </Button>
                </div>
              </div>

              {/* Design tokens */}
              <div className="flex items-center gap-3 flex-wrap rounded-md border border-dashed px-3 py-2">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Design tokens</span>
                <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  Accent
                  <input type="color" value={active.tokens?.accent ?? "#2563eb"}
                    onChange={(e) => {
                      setActive({ ...active, tokens: { ...(active.tokens ?? {}), accent: e.target.value } });
                      refreshPreview({ ...active, tokens: { ...(active.tokens ?? {}), accent: e.target.value } });
                    }}
                    onBlur={async () => {
                      if (!active) return;
                      await fetch(`/api/cms/pages/${active.id}`, {
                        method: "PATCH", credentials: "include",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ tokens: active.tokens ?? {} }),
                      });
                    }}
                    className="size-6 rounded border cursor-pointer" />
                </label>
                <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  Font
                  <select
                    value={active.tokens?.font ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      setActive({ ...active, tokens: { ...(active.tokens ?? {}), font: v } });
                      refreshPreview({ ...active, tokens: { ...(active.tokens ?? {}), font: v } });
                    }}
                    onBlur={async () => {
                      if (!active) return;
                      await fetch(`/api/cms/pages/${active.id}`, {
                        method: "PATCH", credentials: "include",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ tokens: active.tokens ?? {} }),
                      });
                    }}
                    className="rounded border border-input bg-background px-2 py-1 text-xs"
                  >
                    <option value="">System default</option>
                    <option value="Georgia, serif">Serif (Georgia)</option>
                    <option value="'Times New Roman', serif">Times</option>
                    <option value="'Courier New', monospace">Monospace</option>
                    <option value="'Segoe UI', system-ui, sans-serif">Segoe UI</option>
                    <option value="'Trebuchet MS', sans-serif">Trebuchet</option>
                  </select>
                </label>
                <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  Radius
                  <input type="number" min={0} max={32} value={Number(active.tokens?.radius ?? 8)}
                    onChange={(e) => {
                      const v = `${Number(e.target.value)}px`;
                      setActive({ ...active, tokens: { ...(active.tokens ?? {}), radius: v } });
                      refreshPreview({ ...active, tokens: { ...(active.tokens ?? {}), radius: v } });
                    }}
                    onBlur={async () => {
                      if (!active) return;
                      await fetch(`/api/cms/pages/${active.id}`, {
                        method: "PATCH", credentials: "include",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ tokens: active.tokens ?? {} }),
                      });
                    }}
                    className="w-16 rounded border border-input bg-background px-2 py-1 text-xs" />
                </label>
                <span className="text-[10px] text-muted-foreground">Sync across buttons, links &amp; dividers</span>
              </div>
            </div>

            {/* Layer manager (tree view) */}
            {layerOpen && (
              <div className="rounded-lg border bg-muted/30 p-2 max-h-52 overflow-y-auto">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground px-2 pb-1">
                  Layers — click to select &amp; jump
                </p>
                {active.blocks.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground px-2 py-1">No blocks yet.</p>
                ) : (
                  <div className="space-y-0.5">{blockLayerRows(active.blocks, 0)}</div>
                )}
              </div>
            )}

            {/* Blocks canvas */}
            {active.blocks.length === 0 ? (
              <Card className="p-10 text-center text-muted-foreground border-dashed"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); handleDrop({ kind: "root", index: active.blocks.length }); }}>
                <p className="text-sm">Your page is empty.</p>
                <p className="text-xs mt-1">Add a text block, an image, a section, or ask the AI to build a widget.</p>
              </Card>
            ) : (
              <div className="space-y-3"
                onDragOver={(e) => { if (dragId && e.target === e.currentTarget) e.preventDefault(); }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (e.target === e.currentTarget) handleDrop({ kind: "root", index: active.blocks.length });
                }}>
                {active.blocks.map((b, i) =>
                  b.kind === "section" ? sectionCard(b, i, active.blocks.length)
                  : b.kind === "columns" ? columnsCard(b, i, active.blocks.length)
                  : blockCard(b, i, active.blocks.length)
                )}
              </div>
            )}
          </div>

          {/* Right: live preview */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold">Live Preview</span>
              <span className="text-xs text-muted-foreground">Same renderer as the public site</span>
            </div>
            <div className="rounded-xl border bg-white overflow-hidden flex justify-center"
              style={{ width: previewWidth === "mobile" ? 390 : previewWidth === "tablet" ? 768 : "100%" }}>
              <iframe ref={iframeRef} title="Page preview" className="w-full h-[70vh]" sandbox="allow-scripts allow-forms" />
            </div>
          </div>
        </div>
      )}

      {/* ============ SITE SETTINGS ============ */}
      {tab === "site" && (
        <Card className="p-6 max-w-2xl">
          <h2 className="text-lg font-semibold mb-1">Sitewide Settings</h2>
          <p className="text-sm text-muted-foreground mb-5">
            Applied to every published page: site name, header &amp; footer,
            a recommended theme, and an optional custom stylesheet.
          </p>
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>Site Name</Label>
                <Input value={settings.site_name} onChange={(e) => setSettings({ ...settings, site_name: e.target.value })} />
              </div>
              <div>
                <Label>Tagline</Label>
                <Input value={settings.tagline} onChange={(e) => setSettings({ ...settings, tagline: e.target.value })} />
              </div>
            </div>

            <div>
              <Label>Logo (image URL)</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="https://…/logo.png"
                  value={settings.logo_url}
                  onChange={(e) => setSettings({ ...settings, logo_url: e.target.value })}
                />
                <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-border text-sm cursor-pointer hover:bg-muted shrink-0">
                  <Upload className="size-4" />
                  Upload
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const fd = new FormData();
                      fd.append("file", file);
                      const res = await fetch("/api/cms/upload", {
                        method: "POST",
                        credentials: "include",
                        body: fd,
                      });
                      const data = await res.json();
                      if (res.ok && data.url) {
                        setSettings({ ...settings, logo_url: data.url });
                        show("success", "Logo uploaded — save settings to apply.");
                      } else {
                        show("error", data.error ?? "Upload failed");
                      }
                    }}
                  />
                </label>
              </div>
              {settings.logo_url && (
                <div className="mt-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={settings.logo_url} alt="Logo preview" className="h-12 w-auto object-contain rounded border border-border" />
                </div>
              )}
            </div>

            <div>
              <Label>Recommended Theme</Label>
              <div className="flex gap-2 flex-wrap mt-1.5">
                {Object.entries(THEME_PRESETS).map(([key, preset]) => (
                  <button
                    key={key}
                    onClick={() => setSettings({ ...settings, theme_preset: key })}
                    className={`px-3 py-1.5 rounded-md text-sm border transition-colors ${
                      settings.theme_preset === key
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-border hover:bg-muted"
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <Label>Header (markdown — shown on every page)</Label>
              <textarea
                value={settings.header_text}
                onChange={(e) => setSettings({ ...settings, header_text: e.target.value })}
                rows={2}
                placeholder={"e.g. [Home](/site/home)  [Services](/site/services)  [Contact](/site/contact)"}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
              />
            </div>

            {/* Site menu — ordered navigation links shown in the header */}
            <div>
              <Label>Menu (shown in the site header, in order)</Label>
              <p className="text-xs text-muted-foreground mt-0.5 mb-2">
                Point each item at a page (<span className="font-mono">/site/&lt;slug&gt;</span>) or an external URL. Reorder with the arrows.
              </p>
              <datalist id="site-page-slugs">
                {pages.map((p) => (
                  <option key={p.id} value={`/site/${p.slug}`} />
                ))}
              </datalist>
              <div className="space-y-2">
                {settings.site_nav.map((item, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-5 text-right">{i + 1}.</span>
                    <Input
                      value={item.label}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          site_nav: settings.site_nav.map((n, j) => (j === i ? { ...n, label: e.target.value } : n)),
                        })
                      }
                      placeholder="Label"
                      className="w-40"
                    />
                    <Input
                      value={item.href}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          site_nav: settings.site_nav.map((n, j) => (j === i ? { ...n, href: e.target.value } : n)),
                        })
                      }
                      placeholder="/site/home or https://…"
                      list="site-page-slugs"
                      className="flex-1 font-mono text-xs"
                    />
                    <button
                      disabled={i === 0}
                      onClick={() =>
                        setSettings({
                          ...settings,
                          site_nav: settings.site_nav.map((n, j) =>
                            j === i - 1
                              ? settings.site_nav[i]
                              : j === i
                              ? settings.site_nav[i - 1]
                              : n
                          ),
                        })
                      }
                      className="p-1 rounded hover:bg-muted disabled:opacity-30"
                      title="Move up"
                    >
                      <ChevronUp className="size-3.5" />
                    </button>
                    <button
                      disabled={i === settings.site_nav.length - 1}
                      onClick={() =>
                        setSettings({
                          ...settings,
                          site_nav: settings.site_nav.map((n, j) =>
                            j === i + 1
                              ? settings.site_nav[i]
                              : j === i
                              ? settings.site_nav[i + 1]
                              : n
                          ),
                        })
                      }
                      className="p-1 rounded hover:bg-muted disabled:opacity-30"
                      title="Move down"
                    >
                      <ChevronDown className="size-3.5" />
                    </button>
                    <button
                      onClick={() =>
                        setSettings({
                          ...settings,
                          site_nav: settings.site_nav.filter((_, j) => j !== i),
                        })
                      }
                      className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900 text-red-500"
                      title="Remove"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setSettings({
                      ...settings,
                      site_nav: [...settings.site_nav, { label: "New link", href: "/site/home" }],
                    })
                  }
                >
                  <Plus className="size-3.5 mr-1" /> Add menu item
                </Button>
              </div>
            </div>

            <div>
              <Label>Footer (markdown — shown on every page)</Label>
              <textarea
                value={settings.footer_text}
                onChange={(e) => setSettings({ ...settings, footer_text: e.target.value })}
                rows={3}
                placeholder={"© 2026 My Site — [Privacy](/site/privacy) · [Terms](/site/terms)"}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
              />
            </div>

            <div>
              <Label>Custom Domains</Label>
              <p className="text-xs text-muted-foreground mb-2">
                Map a domain (client.com or client.yourdomain.com) to a page. Point the domain&apos;s
                DNS A record at the server, then it serves this site directly. Requires the nginx
                vhost to be applied (scripts/sync-site-domains.cjs).
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                <Input
                  placeholder="client.com"
                  value={newDomain}
                  onChange={(e) => setNewDomain(e.target.value)}
                  className="w-48"
                />
                <select
                  value={newDomainSlug}
                  onChange={(e) => setNewDomainSlug(e.target.value)}
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">Site page…</option>
                  {pages.map((p) => (
                    <option key={p.id} value={p.slug}>/{p.slug} — {p.title}</option>
                  ))}
                </select>
                <Button variant="outline" size="sm" onClick={addDomain} disabled={domainBusy}>
                  {domainBusy ? <Loader2 className="size-3.5 animate-spin mr-1" /> : <Link2 className="size-3.5 mr-1" />}
                  Map domain
                </Button>
              </div>
              {domainMsg && (
                <p className={`text-xs mt-2 ${domainMsg.type === "success" ? "text-green-600" : "text-red-600"}`}>
                  {domainMsg.message}
                </p>
              )}
              {domains.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  {domains.map((d) => (
                    <div key={d.id} className="flex items-center justify-between text-sm border rounded-md px-3 py-2">
                      <span className="font-medium">{d.domain}</span>
                      <span className="text-muted-foreground text-xs">→ /site/{d.site_slug}</span>
                      <button
                        onClick={() => removeDomain(d.id, d.domain)}
                        className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900 text-red-500"
                        title="Unmap"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <Label>Custom Stylesheet (CSS)</Label>
              <textarea
                value={settings.global_css}
                onChange={(e) => setSettings({ ...settings, global_css: e.target.value })}
                rows={6}
                placeholder={".cms-site-header { background: #1e293b; color: #fff; }\n.cms-text h2 { color: #1d4ed8; }"}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
              />
            </div>

            <Button onClick={saveSettings} disabled={savingSettings}>
              {savingSettings ? <Loader2 className="size-4 animate-spin mr-1" /> : null}
              Save Site Settings
            </Button>
          </div>
        </Card>
      )}

      {/* ============ SUBMISSIONS ============ */}
      {tab === "submissions" && (
        <Card className="p-6">
          <h2 className="text-lg font-semibold mb-4">Form Submissions</h2>
          {submissions.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No submissions yet. Publish a page with an AI-built form and submissions appear here.
            </p>
          ) : (
            <div className="space-y-2">
              {submissions.map((s) => (
                <div key={s.id} className="p-3 rounded-lg border">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{new Date(s.submitted_at).toLocaleString()}</span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-2 text-sm">
                    {Object.entries(s.fields ?? {}).map(([k, v]) => (
                      <span key={k} className="bg-muted px-2 py-0.5 rounded text-xs">
                        <span className="font-semibold capitalize">{k.replace(/_/g, " ")}:</span> {String(v)}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
