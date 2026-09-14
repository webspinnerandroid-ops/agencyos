"use client";

import { useEffect, useState } from "react";
import { Building2 } from "lucide-react";
import { getWorkspaces } from "@/lib/workspace";

/**
 * Compact read-only workspace chip — answers "whose data am I looking at?"
 * on every dashboard page (the header selector hides on small screens, and
 * after a misplaced-import incident the workspace context must be visible
 * everywhere). Links to the workspaces manager for switching.
 */
export default function WorkspaceChip() {
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await getWorkspaces();
      if (cancelled || !res.success || !res.data || res.data.length === 0) return;
      const stored = document.cookie
        .split("; ")
        .find((row) => row.startsWith("workspace_id="))
        ?.split("=")[1];
      const active =
        (stored && res.data.find((w) => w.id === stored)) ||
        res.data.find((w) => w.is_default) ||
        res.data[0];
      if (active) setName(active.name);
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!name) return null;

  return (
    <a
      href="/dashboard/workspaces"
      className="inline-flex items-center gap-1.5 rounded-full border bg-muted/50 px-2.5 py-0.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      title="Current workspace — click to manage workspaces"
    >
      <Building2 className="size-3 shrink-0" />
      <span className="max-w-[180px] truncate">{name}</span>
    </a>
  );
}
