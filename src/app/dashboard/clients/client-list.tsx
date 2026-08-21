"use client";

import { useState, useTransition } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, Users, ArrowRight, Loader2 } from "lucide-react";
import { createClient, listClients, type ClientListItem } from "./actions";

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
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleCreate = () => {
    startTransition(async () => {
      try {
        setError(null);
        await createClient({ name, website, notes });
        setOpen(false);
        setName("");
        setWebsite("");
        setNotes("");
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
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger className="inline-flex items-center justify-center gap-2 rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium shadow-sm hover:bg-primary/90 transition-colors">
            <Plus className="size-4" /> Add Client
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Client</DialogTitle>
              <DialogDescription>
                The client&apos;s workspace and onboarding plan are created
                automatically.
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
                </CardHeader>
                <CardContent className="pb-3 space-y-3">
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
    </div>
  );
}
