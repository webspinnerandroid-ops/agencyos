"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  Save,
  RotateCcw,
  Menu,
  GripVertical,
  ArrowRight,
} from "lucide-react";

interface NavItem {
  href: string;
  label: string;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

export default function NavBuilderPage() {
  const [sections, setSections] = useState<NavSection[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [dragItem, setDragItem] = useState<{ section: number; item: number } | null>(null);
  const [dragSection, setDragSection] = useState<number | null>(null);
  const dragOverItem = useRef<{ section: number; item: number } | null>(null);
  const dragOverSection = useRef<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/nav-config", { credentials: "include" });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({ type: "error", message: data.error ?? "Failed to load navigation" });
        return;
      }
      setSections(data.sections ?? []);
    } catch (err: any) {
      setFeedback({ type: "error", message: err.message ?? "Failed to load navigation" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const patchSection = (i: number, patch: Partial<NavSection>) =>
    setSections((prev) =>
      prev ? prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)) : prev
    );

  const patchItem = (si: number, ii: number, patch: Partial<NavItem>) =>
    setSections((prev) =>
      prev
        ? prev.map((s, idx) =>
            idx === si
              ? { ...s, items: s.items.map((it, j) => (j === ii ? { ...it, ...patch } : it)) }
              : s
          )
        : prev
    );

  const swapSections = (from: number, dir: -1 | 1) =>
    setSections((prev) => {
      if (!prev) return prev;
      const to = from + dir;
      if (to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });

  const swapItems = (si: number, from: number, dir: -1 | 1) =>
    patchSection(si, {
      items: (() => {
        const items = sections?.[si]?.items ?? [];
        const to = from + dir;
        if (to < 0 || to >= items.length) return items;
        const next = [...items];
        [next[from], next[to]] = [next[to], next[from]];
        return next;
      })(),
    });

  // ---- Drag & drop ----------------------------------------------------
  const onDropItem = (target: { section: number; item: number }) => {
    const from = dragItem;
    setDragItem(null);
    dragOverItem.current = null;
    if (!from || !sections) return;
    if (from.section === target.section) {
      // Reorder within the same section.
      const items = [...sections[from.section].items];
      const [moved] = items.splice(from.item, 1);
      const to = from.item < target.item ? target.item - 1 : target.item;
      items.splice(Math.max(0, Math.min(to, items.length)), 0, moved);
      patchSection(from.section, { items });
    } else {
      // Move to another section.
      const moved = sections[from.section].items[from.item];
      const src = [...sections[from.section].items];
      src.splice(from.item, 1);
      const dst = [...sections[target.section].items];
      dst.splice(Math.min(target.item, dst.length), 0, moved);
      setSections((prev) =>
        prev
          ? prev.map((s, idx) =>
              idx === from.section ? { ...s, items: src } : idx === target.section ? { ...s, items: dst } : s
            )
          : prev
      );
    }
  };

  const onDropSection = (target: number) => {
    const from = dragSection;
    setDragSection(null);
    dragOverSection.current = null;
    if (from === null || !sections) return;
    setSections((prev) => {
      if (!prev) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      const to = from < target ? target - 1 : target;
      next.splice(Math.max(0, Math.min(to, next.length)), 0, moved);
      return next;
    });
  };

  // Explicit "move item to a different section" (dropdown on each item).
  const moveItemToSection = (si: number, ii: number, targetSection: number) => {
    if (targetSection === si || !sections) return;
    const moved = sections[si].items[ii];
    const src = [...sections[si].items];
    src.splice(ii, 1);
    const dst = [...sections[targetSection].items, moved];
    setSections((prev) =>
      prev
        ? prev.map((s, idx) =>
            idx === si ? { ...s, items: src } : idx === targetSection ? { ...s, items: dst } : s
          )
        : prev
    );
  };

  const save = async () => {
    if (!sections) return;
    setSaving(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/admin/nav-config", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sections }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({ type: "error", message: data.error ?? "Failed to save navigation" });
        return;
      }
      setSections(data.sections ?? sections);
      setFeedback({ type: "success", message: "Navigation saved — the menu updates immediately." });
    } catch (err: any) {
      setFeedback({ type: "error", message: err.message ?? "Failed to save navigation" });
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    if (!confirm("Restore the built-in default navigation? Your custom menu will be replaced.")) return;
    setSaving(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/admin/nav-config", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reset: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({ type: "error", message: data.error ?? "Failed to reset navigation" });
        return;
      }
      setSections(data.sections ?? []);
      setFeedback({ type: "success", message: "Navigation reset to the default." });
    } catch (err: any) {
      setFeedback({ type: "error", message: err.message ?? "Failed to reset navigation" });
    } finally {
      setSaving(false);
    }
  };

  if (loading && !sections) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="size-8 animate-spin mr-3" /> Loading navigation…
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Menu className="size-7 text-primary" /> Menu Builder
        </h1>
        <p className="text-muted-foreground mt-1">
          Drag items to reorder or drop them onto another section. Use the
          dropdown to move an item to a section, or the arrows for fine control.
          Save when done — changes apply immediately.
        </p>
      </div>

      {feedback && (
        <div className={`p-3 rounded-md text-sm border ${feedback.type === "success" ? "bg-green-50 text-green-700 border-green-200" : "bg-red-50 text-red-700 border-red-200"}`} role="alert">
          {feedback.message}
          <button className="ml-3 underline text-xs" onClick={() => setFeedback(null)}>Dismiss</button>
        </div>
      )}

      <div className="space-y-4">
        {(sections ?? []).map((section, si) => (
          <Card
            key={si}
            draggable
            onDragStart={(e) => { setDragSection(si); e.dataTransfer.effectAllowed = "move"; }}
            onDragOver={(e) => { e.preventDefault(); dragOverSection.current = si; }}
            onDragLeave={() => { if (dragOverSection.current === si) dragOverSection.current = null; }}
            onDrop={(e) => { e.preventDefault(); e.stopPropagation(); onDropSection(si); }}
            className={`p-4 cursor-grab active:cursor-grabbing ${dragOverSection.current === si && dragSection !== null && dragSection !== si ? "ring-2 ring-primary" : ""}`}
          >
            <div className="flex items-center gap-2 mb-3">
              <GripVertical className="size-4 text-muted-foreground shrink-0" />
              <Input
                value={section.label}
                onChange={(e) => patchSection(si, { label: e.target.value })}
                className="font-semibold w-56"
                aria-label={`Section ${si + 1} label`}
              />
              <div className="flex items-center gap-0.5 ml-auto">
                <Button variant="ghost" size="sm" disabled={si === 0} onClick={() => swapSections(si, -1)} title="Move section up"><ChevronUp className="size-4" /></Button>
                <Button variant="ghost" size="sm" disabled={si === (sections?.length ?? 0) - 1} onClick={() => swapSections(si, 1)} title="Move section down"><ChevronDown className="size-4" /></Button>
                <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setSections((p) => (p ? p.filter((_, i) => i !== si) : p))} title="Remove section"><Trash2 className="size-4" /></Button>
              </div>
            </div>

            <div className="space-y-2">
              {section.items.map((item, ii) => (
                <div
                  key={ii}
                  draggable
                  onDragStart={(e) => { setDragItem({ section: si, item: ii }); e.dataTransfer.effectAllowed = "move"; }}
                  onDragOver={(e) => { e.preventDefault(); dragOverItem.current = { section: si, item: ii }; }}
                  onDragLeave={() => { if (dragOverItem.current?.section === si && dragOverItem.current?.item === ii) dragOverItem.current = null; }}
                  onDrop={(e) => { e.preventDefault(); e.stopPropagation(); onDropItem({ section: si, item: ii }); }}
                  className={`flex items-center gap-2 rounded-md border p-1.5 cursor-grab active:cursor-grabbing ${
                    dragOverItem.current?.section === si && dragOverItem.current?.item === ii && dragItem
                      ? "ring-2 ring-primary"
                      : "border-transparent"
                  }`}
                >
                  <GripVertical className="size-3.5 text-muted-foreground shrink-0" />
                  <Input
                    value={item.label}
                    onChange={(e) => patchItem(si, ii, { label: e.target.value })}
                    placeholder="Menu label"
                    className="w-44"
                  />
                  <Input
                    value={item.href}
                    onChange={(e) => patchItem(si, ii, { href: e.target.value })}
                    placeholder="/dashboard/…"
                    className="font-mono flex-1"
                  />
                  <select
                    value={si}
                    onChange={(e) => moveItemToSection(si, ii, Number(e.target.value))}
                    className="rounded-md border border-input bg-background px-1.5 py-1 text-xs"
                    title="Move item to another section"
                  >
                    {(sections ?? []).map((s, targetIdx) => (
                      <option key={targetIdx} value={targetIdx}>
                        {targetIdx === si ? `${s.label} (here)` : s.label}
                      </option>
                    ))}
                  </select>
                  <ArrowRight className="size-3.5 text-muted-foreground" />
                  <Button variant="ghost" size="sm" disabled={ii === 0} onClick={() => swapItems(si, ii, -1)} title="Move up"><ChevronUp className="size-3.5" /></Button>
                  <Button variant="ghost" size="sm" disabled={ii === section.items.length - 1} onClick={() => swapItems(si, ii, 1)} title="Move down"><ChevronDown className="size-3.5" /></Button>
                  <Button variant="ghost" size="sm" className="text-destructive" onClick={() => patchSection(si, { items: section.items.filter((_, j) => j !== ii) })} title="Remove item"><Trash2 className="size-3.5" /></Button>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={() => patchSection(si, { items: [...section.items, { label: "New item", href: "/dashboard" }] })}
              >
                <Plus className="size-3.5 mr-1" /> Add item
              </Button>
            </div>
          </Card>
        ))}

        <Button
          variant="outline"
          onClick={() =>
            setSections((p) => [
              ...(p ?? []),
              { label: "New Section", items: [{ label: "New item", href: "/dashboard" }] },
            ])
          }
        >
          <Plus className="size-4 mr-1" /> Add section
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <Button onClick={save} disabled={saving || !sections}>
          {saving ? <Loader2 className="size-4 animate-spin mr-1" /> : <Save className="size-4 mr-1" />}
          Save Navigation
        </Button>
        <Button variant="ghost" onClick={reset} disabled={saving}>
          <RotateCcw className="size-4 mr-1" /> Reset to default
        </Button>
      </div>
    </div>
  );
}
