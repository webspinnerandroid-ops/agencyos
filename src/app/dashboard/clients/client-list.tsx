"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Toast,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, Users, ArrowRight, Loader2, Trash2, CheckCircle2 } from "lucide-react";
import { createClient, deleteClients, listClients, listWorkspaceOptions, type ClientListItem, type WorkspaceOption } from "./actions";
import EditClientDialog from "./edit-client";
import DeleteClientButton from "./delete-client";

const NO_WORKSPACE = "__none__";

/** Lightweight auto-dismissing success toast (no external toast provider). */
function useToast() {
  const [toast, setToast] = useState<{ title: string; description?: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = (t: { title: string; description?: string }) => {
    if (timer.current) clearTimeout(timer.current);
    setToast(t);
    timer.current = setTimeout(() => setToast(null), 3500);
  };

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return { toast, show };
}

const STEP_LABELS = [
  "Client & Workspace",
  "Connect Tools",
  "Brand Profile",
  "Content Plan",
  "Publish Targets",
  "Go Live",
];

export default function ClientsPage({
  initialClients,
}: {
  initialClients: ClientListItem[];
}) {
  const [clients, setClients] = useState(initialClients);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [notes, setNotes] = useState("");
  const [workspaceOptions, setWorkspaceOptions] = useState<WorkspaceOption[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string>(NO_WORKSPACE);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Bulk-selection + delete
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [isDeleting, startDelete] = useTransition();
  const { toast, show } = useToast();

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allSelected = clients.length > 0 && selected.size === clients.length;
  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(clients.map((c) => c.id)));
  };

  const handleBulkDelete = () => {
    startDelete(async () => {
      try {
        setBulkError(null);
        const ids = [...selected];
        const res = await deleteClients(ids);
        setBulkOpen(false);
        setSelected(new Set());
        const fresh = await listClients();
        setClients(fresh);
        show({
          title: "Clients deleted",
          description: `${res.deleted} client${res.deleted === 1 ? "" : "s"} and their data removed.`,
        });
      } catch (e) {
        setBulkError(e instanceof Error ? e.message : "Failed to delete clients");
      }
    });
  };

  // Load the tenant's workspace choices whenever the dialog opens so the user
  // can assign the new client to an existing workspace (instead of only being
  // able to create a new one later in onboarding).
  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next && workspaceOptions.length === 0) {
      listWorkspaceOptions()
        .then((opts) => setWorkspaceOptions(opts))
        .catch(() => setWorkspaceOptions([]));
    }
  };

  const handleCreate = () => {
    startTransition(async () => {
      try {
        setError(null);
        await createClient({
          name,
          website,
          notes,
          workspaceId: workspaceId === NO_WORKSPACE ? null : workspaceId,
        });
        setOpen(false);
        setName("");
        setWebsite("");
        setNotes("");
        setWorkspaceId(NO_WORKSPACE);
        const fresh = await listClients();
        setClients(fresh);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to create client");
      }
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Users className="size-5" /> Clients
          </h1>
          <p className="text-sm text-muted-foreground">
            Every client gets a workspace and a guided onboarding — from first
            connection to live campaign.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="border-red-300 text-red-600 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950/40 dark:text-red-400"
              onClick={() => setBulkOpen(true)}
            >
              <Trash2 className="size-4 mr-1" /> Delete selected ({selected.size})
            </Button>
          )}
          <Dialog open={open} onOpenChange={handleOpenChange}>
          <DialogTrigger className="inline-flex items-center justify-center gap-2 rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium shadow-sm hover:bg-primary/90 transition-colors">
            <Plus className="size-4" /> Add Client
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Client</DialogTitle>
              <DialogDescription>
                Assign the client to an existing workspace, or leave unassigned
                to create its workspace in onboarding.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="client-name" className="text-xs">Client name</Label>
                <Input
                  id="client-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Acme Landscaping"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="client-website" className="text-xs">Website (optional)</Label>
                <Input
                  id="client-website"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  placeholder="https://acme.com"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="client-notes" className="text-xs">Notes (optional)</Label>
                <Textarea
                  id="client-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="What does this client need?"
                  rows={3}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="client-workspace" className="text-xs">Assign workspace</Label>
                <Select value={workspaceId} onValueChange={setWorkspaceId}>
                  <SelectTrigger className="w-full" id="client-workspace">
                    <SelectValue placeholder="Select a workspace…" />
                  </SelectTrigger>
                  <SelectContent className="w-full">
                    <SelectItem value={NO_WORKSPACE}>Create a dedicated workspace (recommended)</SelectItem>
                    {workspaceOptions.map((w) => (
                      <SelectItem key={w.id} value={w.id}>
                        {w.name}
                        {w.is_default ? " (Default)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {workspaceOptions.length === 0 && !isPending && (
                  <p className="text-[11px] text-muted-foreground">
                    No workspaces found — a dedicated workspace will be
                    created for this client automatically.
                  </p>
                )}
              </div>
              {error && <p className="text-xs text-red-600">{error}</p>}
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={handleCreate} disabled={isPending || !name.trim()}>
                {isPending ? <Loader2 className="size-4 animate-spin mr-1" /> : <Plus className="size-4 mr-1" />}
                Create Client
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {clients.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center space-y-3">
            <Users className="size-10 mx-auto text-muted-foreground/40" />
            <p className="font-medium">No clients yet</p>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto">
              Add your first client to create their workspace and start the
              guided onboarding — connections, brand profile, content plan and
              go-live.
            </p>
            <Button size="sm" onClick={() => setOpen(true)}>
              <Plus className="size-4 mr-1" /> Add your first client
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {clients.map((client) => {
            const lc = client.lifecycle;
            const completed = lc?.status === "completed";
            const step = lc?.step ?? 0;
            return (
              <Card key={client.id} className="flex flex-col">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <CardTitle className="text-base">{client.name}</CardTitle>
                      <CardDescription className="text-xs">
                        {client.website ? (
                          <a href={client.website} target="_blank" rel="noreferrer" className="hover:underline">
                            {client.website.replace(/^https?:\/\//, "")}
                          </a>
                        ) : (
                          "No website yet"
                        )}
                      </CardDescription>
                    </div>
                    <Checkbox
                      aria-label={`Select ${client.name}`}
                      checked={selected.has(client.id)}
                      onCheckedChange={() => toggle(client.id)}
                      className="mt-0.5 shrink-0"
                    />
                  </div>
                </CardHeader>
                <CardContent className="pb-3 space-y-3 items-start">
                  <div className="flex items-center gap-1 -mt-1">
                    <EditClientDialog
                      clientId={client.id}
                      clientName={client.name}
                      clientWebsite={client.website}
                      clientNotes={client.notes}
                      onUpdated={async () => {
                        const fresh = await listClients();
                        setClients(fresh);
                      }}
                    />
                    <DeleteClientButton
                      clientId={client.id}
                      clientName={client.name}
                      onDeleted={async () => {
                        const fresh = await listClients();
                        setClients(fresh);
                        show({ title: "Client deleted", description: `${client.name} and its data were removed.` });
                      }}
                    />
                  </div>
                  {completed ? (
                    <Badge className="bg-green-600 text-white">Onboarding complete</Badge>
                  ) : lc ? (
                    <div className="space-y-1.5">
                      <Badge variant="outline" className="text-[10px]">
                        Step {Math.min(step + 1, 6)} of 6 — {STEP_LABELS[Math.min(step, 5)]}
                      </Badge>
                      <div className="flex gap-1">
                        {STEP_LABELS.map((_, i) => (
                          <div
                            key={i}
                            className={`h-1 flex-1 rounded-full ${i <= step ? "bg-primary" : "bg-muted"}`}
                          />
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">Onboarding not started.</p>
                  )}
                  <div className="flex items-center gap-2">
                    <Link href={`/dashboard/clients/${client.id}`} className="flex-1">
                      <Button size="sm" className="w-full">
                        Open <ArrowRight className="size-3 ml-1" />
                      </Button>
                    </Link>
                    {!completed && (
                      <Link href={`/dashboard/clients/${client.id}/onboarding`} className="flex-1">
                        <Button size="sm" variant="outline" className="w-full">
                          Onboard
                        </Button>
                      </Link>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
      {/* Bulk delete confirm */}
      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {selected.size} client{selected.size === 1 ? "" : "s"}?</DialogTitle>
            <DialogDescription>
              This permanently removes the selected clients and everything
              tied to them — posts, SEO campaigns, onboarding, and their own
              exclusive workspaces. It cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-44 overflow-auto rounded-md border p-2 space-y-1">
            {clients.filter((c) => selected.has(c.id)).map((c) => (
              <div key={c.id} className="flex items-center justify-between text-sm py-1 px-1 rounded hover:bg-muted">
                <span className="truncate">{c.name}</span>
                <Trash2 className="size-3.5 text-red-500 shrink-0 ml-2" />
              </div>
            ))}
          </div>
          {bulkError && <p className="text-xs text-red-600">{bulkError}</p>}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBulkOpen(false)} disabled={isDeleting}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleBulkDelete}
              disabled={isDeleting}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {isDeleting ? <Loader2 className="size-4 animate-spin mr-1" /> : <Trash2 className="size-4 mr-1" />}
              Delete {selected.size}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Toaster */}
      <ToastProvider>
        <div className="pointer-events-none fixed bottom-4 right-4 z-[120]">
          {toast && (
            <Toast className="pointer-events-auto w-80">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="size-5 text-green-600 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <ToastTitle>{toast.title}</ToastTitle>
                  {toast.description && <ToastDescription>{toast.description}</ToastDescription>}
                </div>
              </div>
            </Toast>
          )}
        </div>
        <ToastViewport className="hidden" />
      </ToastProvider>
    </div>
  );
}
