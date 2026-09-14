"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Trash2, Loader2 } from "lucide-react";
import { deleteClient } from "./actions";

/**
 * Destructive delete for a client (agency_admin+). Removes the client, its
 * onboarding row (cascade), and unassigns user roles — posts/assets are kept
 * but orphaned from the client.
 */
export default function DeleteClientButton({
  clientId,
  clientName,
  onDeleted,
}: {
  clientId: string;
  clientName: string;
  /** Called after a successful delete so the parent can refresh its list. */
  onDeleted?: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleDelete = () => {
    startTransition(async () => {
      try {
        setError(null);
        await deleteClient(clientId);
        setOpen(false);
        if (onDeleted) {
          onDeleted();
        } else {
          // No callback (e.g. the detail page) — leave the client views.
          router.push("/dashboard/clients");
        }
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to delete client");
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="inline-flex items-center gap-1 rounded-md text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/40 px-2 py-1.5 text-sm transition-colors">
        <Trash2 className="size-3.5" /> Delete
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete “{clientName}”?</DialogTitle>
          <DialogDescription>
            This removes the client and its onboarding plan permanently. Posts
            and assets stay in the workspace but are no longer linked to this
            client. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={isPending}
            className="bg-red-600 text-white hover:bg-red-700"
          >
            {isPending ? <Loader2 className="size-4 animate-spin mr-1" /> : <Trash2 className="size-4 mr-1" />}
            Delete client
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
