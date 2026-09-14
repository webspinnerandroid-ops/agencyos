"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, CornerDownLeft, Users, LayoutGrid } from "lucide-react";
import type { NavSection } from "./NavDropdown";

interface PaletteItem {
  label: string;
  href: string;
  group: string;
}

interface ClientHit {
  id: string;
  name: string;
}

/**
 * Global ⌘K / Ctrl+K command palette: search every page in the tenant's nav
 * (custom Menu Builder config included) plus the client list. Enter navigates
 * to the highlighted result; arrows move; Escape closes.
 */
export default function CommandPalette({ sections }: { sections: NavSection[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [clients, setClients] = useState<ClientHit[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Toggle with ⌘K / Ctrl+K, or the visible header search button
  // (dispatches the open-command-palette event).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
        setQuery("");
      }
    };
    const onOpen = () => {
      setOpen(true);
      setQuery("");
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("open-command-palette", onOpen);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("open-command-palette", onOpen);
    };
  }, []);

  // Focus the input when opened; fetch clients lazily the first time.
  useEffect(() => {
    if (!open) return;
    setActive(0);
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    if (clients.length === 0) {
      fetch("/api/clients", { credentials: "include" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          const list = Array.isArray(d?.clients) ? (d.clients as ClientHit[]) : [];
          setClients(list);
        })
        .catch(() => {});
    }
    return () => clearTimeout(t);
  }, [open, clients.length]);

  const items = useMemo<PaletteItem[]>(() => {
    const nav: PaletteItem[] = (sections ?? []).flatMap((s) =>
      (s.items ?? []).map((it) => ({ label: it.label, href: it.href, group: s.label }))
    );
    const clientItems: PaletteItem[] = clients.map((c) => ({
      label: c.name,
      href: `/dashboard/clients/${c.id}`,
      group: "Clients",
    }));
    const all = [...nav, ...clientItems];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (it) => it.label.toLowerCase().includes(q) || it.href.toLowerCase().includes(q)
    );
  }, [sections, clients, query]);

  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(items.length - 1, 0)));
  }, [items.length]);

  if (!open) return null;

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = items[active];
      if (target) go(target.href);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[90] bg-black/40 flex items-start justify-center pt-[15vh] px-4"
      style={{ position: "fixed", inset: 0, zIndex: 90, backgroundColor: "rgba(0,0,0,0.4)" }}
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-md rounded-lg border bg-popover text-popover-foreground shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="size-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search pages, clients…"
            className="flex-1 bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
            aria-label="Command palette search"
          />
          <kbd className="text-[10px] text-muted-foreground border rounded px-1">esc</kbd>
        </div>
        <div className="max-h-[50vh] overflow-y-auto py-1">
          {items.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground text-center">
              Nothing matches “{query}”.
            </p>
          ) : (
            items.map((item, i) => (
              <button
                key={`${item.group}-${item.href}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(item.href)}
                className={`w-full flex items-center gap-3 px-3 py-2 text-left text-sm transition-colors ${
                  i === active ? "bg-primary/10 text-primary" : "hover:bg-muted"
                }`}
              >
                {item.group === "Clients" ? (
                  <Users className="size-4 shrink-0 text-muted-foreground" />
                ) : (
                  <LayoutGrid className="size-4 shrink-0 text-muted-foreground" />
                )}
                <span className="flex-1 truncate">{item.label}</span>
                {i === active && <CornerDownLeft className="size-3 text-muted-foreground shrink-0" />}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
