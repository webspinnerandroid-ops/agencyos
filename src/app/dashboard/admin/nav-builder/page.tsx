"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Loader2,
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  Save,
  RotateCcw,
  Menu,
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

  const move = <T,>(arr: T[], from: number, dir: -1 | 1): T[] => {
    const to = from + dir;
    if (to < 0 || to >= arr.length) return arr;
    const next = [...arr];
    [next[from], next[to]] = [next[to], next[from]];
    return next;
  };

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
          Reorder, rename, add, or remove items in the app menu. Changes apply
          to this workspace&apos;s navigation immediately.
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
          <Card key={si} className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Input
                value={section.label}
                onChange={(e) => patchSection(si, { label: e.target.value })}
                className="font-semibold w-56"
                aria-label={`Section ${si + 1} label`}
              />
              <div className="flex items-center gap-0.5 ml-auto">
                <Button variant="ghost" size="sm" disabled={si === 0} onClick={() => setSections((p) => (p ? move(p, si, -1) : p))} title="Move section up"><ChevronUp className="size-4" /></Button>
                <Button variant="ghost" size="sm" disabled={si === (sections?.length ?? 0) - 1} onClick={() => setSections((p) => (p ? move(p, si, 1) : p))} title="Move section down"><ChevronDown className="size-4" /></Button>
                <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setSections((p) => (p ? p.filter((_, i) => i !== si) : p))} title="Remove section"><Trash2 className="size-4" /></Button>
              </div>
            </div>

            <div className="space-y-2">
              {section.items.map((item, ii) => (
                <div key={ii} className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-6 text-right">{ii + 1}.</span>
                  <Input
                    value={item.label}
                    onChange={(e) => patchItem(si, ii, { label: e.target.value })}
                    placeholder="Menu label"
                    className="w-48"
                  />
                  <Input
                    value={item.href}
                    onChange={(e) => patchItem(si, ii, { href: e.target.value })}
                    placeholder="/dashboard/…"
                    className="font-mono flex-1"
                  />
                  <Button variant="ghost" size="sm" disabled={ii === 0} onClick={() => patchSection(si, { items: move(section.items, ii, -1) })} title="Move up"><ChevronUp className="size-3.5" /></Button>
                  <Button variant="ghost" size="sm" disabled={ii === section.items.length - 1} onClick={() => patchSection(si, { items: move(section.items, ii, 1) })} title="Move down"><ChevronDown className="size-3.5" /></Button>
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
