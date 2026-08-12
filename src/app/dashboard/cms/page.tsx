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
  Palette,
} from "lucide-react";
import {
  newBlockId,
  slugify,
  renderBlockHtml,
  CMS_STYLES,
  THEME_PRESETS,
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
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiBuilding, setAiBuilding] = useState(false);
  const [submissions, setSubmissions] = useState<any[]>([]);
  // Drag-and-drop state
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dragOverSection, setDragOverSection] = useState<string | null>(null);
  const [styleOpen, setStyleOpen] = useState<string | null>(null);
  // Sitewide settings
  const [settings, setSettings] = useState<{
    site_name: string;
    tagline: string;
    header_text: string;
    footer_text: string;
    global_css: string;
    theme_preset: string;
  }>({
    site_name: "My Site",
    tagline: "",
    header_text: "",
    footer_text: "",
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
    setActive(page);
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

  const updateBlock = (id: string, patch: Partial<CmsBlock>) => {
    if (!active) return;
    const mapBlocks = (list: CmsBlock[]): CmsBlock[] =>
      list.map((b) => {
        if (b.id === id) return { ...b, ...patch };
        if (b.kind === "section" && b.children?.length) return { ...b, children: mapBlocks(b.children) };
        return b;
      });
    updateBlocks(mapBlocks(active.blocks));
  };

  const removeBlock = (id: string) => {
    if (!active) return;
    const found = active.blocks.some((b) => b.id === id || (b.kind === "section" && b.children?.some((c) => c.id === id)));
    if (!confirm(`Remove this ${found ? "block" : "block"}?`)) return;
    const filterBlocks = (list: CmsBlock[]): CmsBlock[] =>
      list
        .filter((b) => b.id !== id)
        .map((b) => (b.kind === "section" && b.children?.length ? { ...b, children: b.children.filter((c) => c.id !== id) } : b));
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
        if (b.id === sectionId && b.kind === "section") {
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
        if (b.kind === "section" && b.children?.length) {
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
    setActive(data.page);
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
    const doc = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${CMS_STYLES}</style></head><body><div class="cms-shell">${html}</div></body></html>`;
    if (iframeRef.current) iframeRef.current.srcdoc = doc;
  };

  useEffect(() => {
    if (active && iframeRef.current) {
      const html = active.blocks.map((b) => renderBlockHtml(b, active.id)).join("\n");
      iframeRef.current.srcdoc = `<!DOCTYPE html><html><head><style>${CMS_STYLES}</style></head><body><div class="cms-shell">${html}</div></body></html>`;
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
          header_text: headerBlocks.map((b) => b.content ?? "").join("\n\n"),
          footer_text: footerBlocks.map((b) => b.content ?? "").join("\n\n"),
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
          header_blocks: toBlock(settings.header_text),
          footer_blocks: toBlock(settings.footer_text),
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
    b.kind === "text" ? <Text className="size-3" /> : b.kind === "image" ? <Image className="size-3" /> : b.kind === "section" ? <Layers className="size-3" /> : <Wand2 className="size-3" />;

  const blockTypeLabel = (b: CmsBlock) =>
    b.kind === "text" ? "Text" : b.kind === "image" ? "Image" : b.kind === "section" ? "Section" : `Widget: ${b.content ?? "AI"}`;

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
          <Input placeholder="Image URL (paste a media URL)" value={b.url ?? ""}
            onChange={(e) => updateBlock(b.id, { url: e.target.value })} />
          <Input placeholder="Alt text (SEO)" value={b.alt ?? ""}
            onChange={(e) => updateBlock(b.id, { alt: e.target.value })} />
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
    </>
  );

  // Single card for a non-section block (root or inside a section).
  const blockCard = (b: CmsBlock, index: number, listLength: number, sectionId?: string, moveFn?: (dir: -1 | 1) => void) => (
    <Card key={b.id}
      draggable
      onDragStart={(e) => { setDragId(b.id); e.dataTransfer.effectAllowed = "move"; }}
      onDragOver={(e) => { e.preventDefault(); setDragOverId(b.id); }}
      onDragLeave={() => setDragOverId((cur) => (cur === b.id ? null : cur))}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); handleDrop(sectionId ? { kind: "section", sectionId, index } : { kind: "root", index }); }}
      className={`p-3 cursor-grab active:cursor-grabbing ${dragOverId === b.id && dragId !== b.id ? "ring-2 ring-primary" : ""}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
          <GripVertical className="size-3.5" /> {blockTypeIcon(b)} {blockTypeLabel(b)}
        </span>
        <div className="flex items-center gap-0.5">
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
                    {p.is_published && (
                      <a href={`/site/${p.slug}`} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()}
                        className="text-primary hover:underline text-xs inline-flex items-center gap-1">
                        <ExternalLink className="size-3" /> View
                      </a>
                    )}
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
            <div className="flex gap-2 flex-wrap">
              <Button variant="outline" size="sm" onClick={addTextBlock}><Text className="size-3.5 mr-1" /> Text</Button>
              <Button variant="outline" size="sm" onClick={addImageBlock}><Image className="size-3.5 mr-1" /> Image</Button>
              <Button variant="outline" size="sm" onClick={addSection}><Layers className="size-3.5 mr-1" /> Section</Button>
              <div className="flex-1 min-w-[220px] flex gap-2">
                <Input placeholder="Ask AI to build a block — e.g. 'a contact form', 'an interactive map', 'a YouTube embedder', 'an Instagram gallery embedder'"
                  value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && buildAiBlock()} />
                <Button size="sm" onClick={buildAiBlock} disabled={aiBuilding || !aiPrompt.trim()} title="Build this block with AI">
                  {aiBuilding ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
                </Button>
              </div>
            </div>

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
                  b.kind === "section" ? sectionCard(b, i, active.blocks.length) : blockCard(b, i, active.blocks.length)
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
            <div className="rounded-xl border bg-white overflow-hidden">
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
