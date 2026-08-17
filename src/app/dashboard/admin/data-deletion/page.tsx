"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Trash2, Building2, CheckCircle2, ShieldAlert, Clock, Mail } from "lucide-react";
import {
  getDataDeletionRequests,
  processDataDeletion,
  type DataDeletionRequest,
} from "../actions";

export default function DataDeletionQueuePage() {
  const [requests, setRequests] = useState<DataDeletionRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await getDataDeletionRequests();
    if (!res.success) {
      setError(res.error ?? "Failed to load requests");
    } else {
      setRequests(res.data ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const pending = requests.filter((r) => !r.processed);
  const processed = requests.filter((r) => r.processed);

  const handleProcess = async (req: DataDeletionRequest, mode: "user" | "tenant" | "none") => {
    const label = mode === "user"
      ? "delete this account"
      : mode === "tenant"
      ? "delete this account AND its entire tenant (all workspaces, content, assets)"
      : "mark as processed without deleting";
    if (!confirm(`Process this request?\n\n${req.actor_email ?? "unknown"} — ${label}?`)) return;
    setBusyId(req.id);
    setFeedback(null);
    try {
      const res = await processDataDeletion(req.id, mode);
      if (!res.success) {
        setFeedback(`⚠️ ${res.error ?? "Failed"}`);
      } else {
        setFeedback(
          res.data?.deleted
            ? `✓ ${req.actor_email} was deleted.`
            : `✓ ${req.actor_email} marked processed (no deletion).`
        );
      }
      await load();
    } catch (err: any) {
      setFeedback(`⚠️ ${err?.message ?? "Failed"}`);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-2">
        <Trash2 className="size-6 text-primary" />
        <h1 className="text-2xl font-bold tracking-tight">Data Deletion Queue</h1>
      </div>
      <p className="text-muted-foreground text-sm">
        Requests submitted through the public{" "}
        <a href="/data-deletion" className="text-primary underline">data deletion page</a>{" "}
        (required by Meta / Google / app-store review). Processing a request deletes the
        account — or the account and its whole tenant. Super admin accounts can never be deleted.
      </p>

      {feedback && (
        <div className="p-3 rounded-md bg-muted border text-sm">{feedback}</div>
      )}
      {error && (
        <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm">{error}</div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : pending.length === 0 ? (
        <Card className="p-12 text-center text-muted-foreground">
          <CheckCircle2 className="size-10 mx-auto mb-3 text-green-600" />
          <p className="text-sm">No pending data-deletion requests.</p>
          <p className="text-xs mt-1">Requests from the public page will appear here.</p>
        </Card>
      ) : (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">
            Pending ({pending.length})
          </h2>
          {pending.map((req) => (
            <Card key={req.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Mail className="size-4 text-primary shrink-0" />
                    <span className="font-medium">{req.actor_email ?? "unknown"}</span>
                    <Badge variant="secondary">
                      <Clock className="size-3 mr-1" />
                      {new Date(req.created_at).toLocaleString("en-US", {
                        month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit",
                      })}
                    </Badge>
                  </div>
                  {(req.details as any)?.reason && (
                    <p className="text-sm text-muted-foreground mt-1.5">
                      Reason: {(req.details as any).reason}
                    </p>
                  )}
                  {(req.details as any)?.ip && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      IP: {(req.details as any).ip}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-wrap shrink-0">
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={busyId === req.id}
                    onClick={() => handleProcess(req, "user")}
                  >
                    {busyId === req.id ? <Loader2 className="size-3 animate-spin mr-1" /> : <Trash2 className="size-3 mr-1" />}
                    Delete account
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-destructive border-destructive/40"
                    disabled={busyId === req.id}
                    onClick={() => handleProcess(req, "tenant")}
                  >
                    {busyId === req.id ? <Loader2 className="size-3 animate-spin mr-1" /> : <Building2 className="size-3 mr-1" />}
                    Delete tenant
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busyId === req.id}
                    onClick={() => handleProcess(req, "none")}
                  >
                    Mark processed
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {processed.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground">Processed ({processed.length})</h3>
          {processed.map((req) => {
            const d = (req.details as any) ?? {};
            return (
              <div key={req.id} className="flex items-center justify-between rounded-lg border p-3 text-sm">
                <div className="flex items-center gap-2 min-w-0">
                  <CheckCircle2 className="size-4 text-green-600 shrink-0" />
                  <span className="truncate">{req.actor_email ?? "unknown"}</span>
                  <span className="text-xs text-muted-foreground truncate">{d.outcome ?? ""}</span>
                </div>
                <span className="text-xs text-muted-foreground shrink-0">
                  {d.processedAt ? new Date(d.processedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-start gap-2 p-3 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-xs text-amber-800 dark:text-amber-200">
        <ShieldAlert className="size-4 shrink-0 mt-0.5" />
        <span>
          Every action here is written to the admin audit log with the acting admin&apos;s email.
          Accounts holding a super-admin role are always protected and cannot be deleted or demoted.
        </span>
      </div>
    </div>
  );
}
