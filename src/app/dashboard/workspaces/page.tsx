"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Trash2, Building2, ArrowRight } from "lucide-react";
import Link from "next/link";
import { getWorkspaces, createWorkspace, deleteWorkspace, type Workspace } from "@/lib/workspace";

export default function WorkspacesPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [feedback, setFeedback] = useState<{ type: string; message: string } | null>(null);
  const [isLoading, startLoading] = useTransition();
  const [isPending, startTransition] = useTransition();
  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");

  const load = useCallback(() => {
    startLoading(async () => {
      const res = await getWorkspaces();
      if (res.success && res.data) setWorkspaces(res.data);
    });
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = () => {
    if (!newName.trim()) return;
    startTransition(async () => {
      const res = await createWorkspace(newName, newDesc || undefined);
      if (res.success) {
        setNewName("");
        setNewDesc("");
        setShowForm(false);
        setFeedback({ type: "success", message: `Workspace "${newName}" created.` });
        load();
      } else {
        setFeedback({ type: "error", message: res.error ?? "Failed to create." });
      }
    });
  };

  const handleDelete = (id: string, name: string) => {
    if (!confirm(`Delete "${name}"? All data in this workspace will be permanently removed.`)) return;
    startTransition(async () => {
      const res = await deleteWorkspace(id);
      if (res.success) { setFeedback({ type: "success", message: `${name} deleted.` }); load(); }
      else setFeedback({ type: "error", message: res.error ?? "Failed." });
    });
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Workspaces</h1>
          <p className="text-muted-foreground mt-1">Manage your workspaces. Each workspace has its own knowledgebase, brand profiles, and client data.</p>
        </div>
        <Button onClick={() => setShowForm(!showForm)} disabled={isPending}>
          {showForm ? "Cancel" : <><Plus className="size-4 mr-2" /> New Workspace</>}
        </Button>
      </div>

      {feedback && (
        <div className={`p-3 rounded-md text-sm ${feedback.type === "success" ? "bg-green-50 text-green-700 border-green-200" : "bg-red-50 text-red-700 border-red-200"} border`} role="alert">
          {feedback.message}<button className="ml-3 underline text-xs" onClick={() => setFeedback(null)}>Dismiss</button>
        </div>
      )}

      {showForm && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Building2 className="size-5 text-primary" /> Create Workspace</CardTitle><CardDescription>Each workspace is an isolated environment with its own knowledgebase and settings.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2"><Label>Workspace Name</Label><Input placeholder="My Agency Workspace" value={newName} onChange={(e) => setNewName(e.target.value)} disabled={isPending} /></div>
            <div className="space-y-2"><Label>Description (optional)</Label><Input placeholder="A brief description..." value={newDesc} onChange={(e) => setNewDesc(e.target.value)} disabled={isPending} /></div>
          </CardContent>
          <CardFooter><Button onClick={handleCreate} disabled={isPending || !newName.trim()}>{isPending ? <><Loader2 className="size-4 animate-spin mr-2" /> Creating...</> : "Create Workspace"}</Button></CardFooter>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {workspaces.map((w) => (
          <Card key={w.id} className={w.is_default ? "border-primary" : ""}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span className="flex items-center gap-2 truncate"><Building2 className="size-4 text-primary shrink-0" />{w.name}</span>
                {w.is_default && <Badge variant="default" className="text-xs">Default</Badge>}
              </CardTitle>
              <CardDescription className="line-clamp-2">{w.description || "No description"}</CardDescription>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              Slug: {w.slug}<br />Created: {new Date(w.created_at).toLocaleDateString()}
            </CardContent>
            <CardFooter className="flex gap-2">
              <Link href={`/dashboard/workspaces/${w.id}/knowledgebase`}><Button variant="outline" size="sm">Knowledgebase <ArrowRight className="size-3 ml-1" /></Button></Link>
              <Link href={`/dashboard/workspaces/${w.id}/brand-profile`}><Button variant="outline" size="sm">Brand Profile <ArrowRight className="size-3 ml-1" /></Button></Link>
              <Button variant="ghost" size="icon" className="ml-auto text-muted-foreground hover:text-destructive" onClick={() => handleDelete(w.id, w.name)} disabled={isPending}><Trash2 className="size-4" /></Button>
            </CardFooter>
          </Card>
        ))}
        {workspaces.length === 0 && !isLoading && (
          <div className="col-span-full text-center py-12 text-muted-foreground">
            <Building2 className="size-12 mx-auto mb-4 opacity-30" />
            <p>No workspaces yet. Create your first workspace to get started.</p>
          </div>
        )}
        {isLoading && <div className="col-span-full flex justify-center py-12"><Loader2 className="size-8 animate-spin text-muted-foreground" /></div>}
      </div>
    </div>
  );
}