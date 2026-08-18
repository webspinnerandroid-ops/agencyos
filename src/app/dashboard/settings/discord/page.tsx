"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Loader2, Send, Link2, Unlink, Check, MessageSquare } from "lucide-react";
import {
  getDiscordStatus,
  startDiscordConnect,
  disconnectDiscord,
  sendDiscordTest,
  type DiscordStatus,
} from "./actions";

export default function DiscordSettingsPage() {
  const [status, setStatus] = useState<DiscordStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pendingCode, setPendingCode] = useState<{ code: string; expiresAt: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await getDiscordStatus();
    setLoading(false);
    if (res.success && res.data) {
      setStatus(res.data);
      setError("");
    } else {
      setError(res.error ?? "Couldn't load Discord status");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const connect = async () => {
    setBusy(true);
    setError("");
    const res = await startDiscordConnect();
    setBusy(false);
    if (res.success && res.data) {
      setPendingCode({ code: res.data.code, expiresAt: res.data.expiresAt });
    } else {
      setError(res.error ?? "Couldn't start connecting");
    }
  };

  const disconnect = async () => {
    setBusy(true);
    setError("");
    const res = await disconnectDiscord();
    setBusy(false);
    if (res.success) {
      setPendingCode(null);
      await load();
    } else {
      setError(res.error ?? "Couldn't disconnect");
    }
  };

  const test = async () => {
    setBusy(true);
    setError("");
    const res = await sendDiscordTest();
    setBusy(false);
    if (!res.success) setError(res.error ?? "Couldn't send test");
  };

  const copyCode = async () => {
    if (!pendingCode) return;
    try {
      await navigator.clipboard.writeText(`/connect ${pendingCode.code}`);
    } catch {
      // ignore
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <MessageSquare className="size-6 text-primary" /> Discord
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Get your app notifications in Discord and message your AI team from a
          DM — even when you're away from the dashboard.
        </p>
      </div>

      {error && (
        <div className="p-3 rounded-md bg-red-50 text-red-700 border border-red-200 text-sm">{error}</div>
      )}

      {!status?.configured && (
        <Card>
          <CardHeader>
            <CardTitle>Discord isn't configured on this server yet</CardTitle>
            <CardDescription>
              The owner needs to add a <code>DISCORD_BOT_TOKEN</code> to the
              server environment, then reload this page.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {status?.configured && !status.connected && !pendingCode && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Link2 className="size-4" /> Connect Discord
            </CardTitle>
            <CardDescription>
              Generate a code, then DM{" "}
              <strong>@{status.botUsername ?? "your bot"}</strong> on Discord with{" "}
              <code>/connect &lt;code&gt;</code>. That binds this DM to your account.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={connect} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin mr-1" /> : <Link2 className="size-4 mr-1" />}
              Generate connect code
            </Button>
          </CardContent>
        </Card>
      )}

      {status?.configured && !status.connected && pendingCode && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Link2 className="size-4" /> One more step
            </CardTitle>
            <CardDescription>
              Open Discord, DM{" "}
              <strong>@{status.botUsername ?? "your bot"}</strong>, and send:
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded border bg-muted px-2 py-1.5 text-xs font-mono break-all">
                /connect {pendingCode.code}
              </code>
              <Button variant="outline" size="sm" onClick={copyCode}>Copy</Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Code expires{" "}
              {new Date(pendingCode.expiresAt).toLocaleTimeString("en-US", {
                hour: "numeric",
                minute: "2-digit",
              })}
              . If it expires, just generate a new one.
            </p>
            <Button onClick={load} variant="outline" disabled={busy}>
              <Check className="size-4 mr-1" /> I've connected — check
            </Button>
          </CardContent>
        </Card>
      )}

      {status?.configured && status.connected && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-green-600">
              <Check className="size-4" /> Connected
            </CardTitle>
            <CardDescription>
              DM {status.channelMasked} is linked to this account. Notifications
              and team replies mirror here automatically.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button onClick={test} disabled={busy} variant="outline">
              {busy ? <Loader2 className="size-4 animate-spin mr-1" /> : <Send className="size-4 mr-1" />}
              Send test message
            </Button>
            <Button onClick={disconnect} disabled={busy} variant="destructive">
              <Unlink className="size-4 mr-1" /> Disconnect
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
