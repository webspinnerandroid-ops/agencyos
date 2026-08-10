"use client";

import { useCallback, useEffect, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Building2, Plus } from "lucide-react";
import { getWorkspaces, type Workspace } from "@/lib/workspace";
import Link from "next/link";

export default function WorkspaceSelector() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeId, setActiveId] = useState<string>("");

  const load = useCallback(async () => {
    const res = await getWorkspaces();
    if (res.success && res.data) {
      setWorkspaces(res.data);
      // Read stored workspace from cookie or default
      const stored = document.cookie
        .split("; ")
        .find((row) => row.startsWith("workspace_id="))
        ?.split("=")[1];
      if (stored && res.data.find((w) => w.id === stored)) {
        setActiveId(stored);
      } else {
        const def = res.data.find((w) => w.is_default) ?? res.data[0];
        if (def) setActiveId(def.id);
      }
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleChange = (value: string) => {
    if (value === "__new__") return;
    setActiveId(value);
    document.cookie = `workspace_id=${value}; path=/; max-age=31536000`;
    window.location.reload();
  };

  const active = workspaces.find((w) => w.id === activeId);

  return (
    <div className="flex items-center gap-2">
      <Select value={activeId} onValueChange={handleChange}>
        <SelectTrigger className="w-full max-w-[180px] h-8 text-xs">
          <SelectValue>
            <span className="flex items-center gap-1.5">
              <Building2 className="size-3 shrink-0" />
              <span className="truncate">{active?.name ?? "Select workspace..."}</span>
            </span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {workspaces.map((w) => (
            <SelectItem key={w.id} value={w.id}>
              <span className="flex items-center gap-2">
                {w.name}
                {w.is_default && <Badge variant="secondary" className="text-[10px] px-1 py-0">Default</Badge>}
              </span>
            </SelectItem>
          ))}
          <div className="border-t mt-1 pt-1">
            <Link href="/dashboard/workspaces" className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground cursor-pointer">
              <Plus className="size-3" /> Manage Workspaces
            </Link>
          </div>
        </SelectContent>
      </Select>
    </div>
  );
}