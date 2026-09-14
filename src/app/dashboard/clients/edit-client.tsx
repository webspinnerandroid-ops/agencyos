"use client";

import { useState, useTransition } from "react";
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
import { Pencil, Loader2 } from "lucide-react";
import { updateClient } from "./actions";

export default function EditClientDialog({
  clientId,
  clientName,
  clientWebsite,
  clientNotes,
  onUpdated,
}: {
  clientId: string;
  clientName: string;
  clientWebsite: string | null;
  clientNotes: string | null;
  onUpdated?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(clientName);
  const [website, setWebsite] = useState(clientWebsite ?? "");
  const [notes, setNotes] = useState(clientNotes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSave = () => {
    startTransition(async () => {
      try {
        setError(null);
        await updateClient(clientId, { name, website, notes });
        setOpen(false);
        onUpdated?.();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to update client");
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="inline-flex items-center gap-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted px-2 py-1.5 text-sm transition-colors">
        <Pencil className="size-3.5" /> Edit
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit client</DialogTitle>
          <DialogDescription>
            Update the client&apos;s name, website, or notes.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="edit-client-name" className="text-xs">Client name</Label>
            <Input
              id="edit-client-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Landscaping"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="edit-client-website" className="text-xs">Website (optional)</Label>
            <Input
              id="edit-client-website"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              placeholder="https://acme.com"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="edit-client-notes" className="text-xs">Notes (optional)</Label>
            <Textarea
              id="edit-client-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What does this client need?"
              rows={3}
            />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={isPending}>Cancel</Button>
          <Button onClick={handleSave} disabled={isPending || !name.trim()}>
            {isPending ? <Loader2 className="size-4 animate-spin mr-1" /> : <Pencil className="size-4 mr-1" />}
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}