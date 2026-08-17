"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Loader2, Send, Link2, Unlink, Check, Bell, BellOff } from "lucide-react";
import {
  getTelegramStatus,
  startTelegramConnect,
  disconnectTelegram,
  setTelegramAlertOnly,
  sendTelegramTest,
  type TelegramStatus,
} from "./actions";

export default function TelegramSettingsPage() {
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pendingLink, setPendingLink] = useState<{ link: string; expiresAt: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await getTelegramStatus();
    setLoading(false);
    if (res.success && res.data) {
      setStatus(res.data);
      setError("");
    } else {
      setError(res.error ?? "Couldn't load Telegram status");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const connect = async () => {
    setBusy(true);
    setError("");
    const res = await startTelegramConnect();
    setBusy(false);
    if (res.success && res.data) {
      setPendingLink({ link: res.data.link, expiresAt: res.data.expiresAt });
    } else {
      setError(res.error ?? "Couldn't start connecting");
    }
  };

  const disconnect = async () => {
    setBusy(true);
    setError("");
    const res = await disconnectTelegram();
    setBusy(false);
    if (res.success) {
      setPendingLink(null);
      await load();
    } else {
      setError(res.error ?? "Couldn't disconnect");
    }
  };

  const toggleAlertOnly = async (alertOnly: boolean) => {
    setBusy(true);
    setError("");
    const res = await setTelegramAlertOnly(alertOnly);
    setBusy(false);
    if (res.success) {
      setStatus((s) => (s ? { ...s, alertOnly } : s));
    } else {
      setError(res.error ?? "Couldn't update preference");
    }
  };

  const test = async () => {
    setBusy(true);
    setError("");
    const res = await sendTelegramTest();
    setBusy(false);
    if (!res.success) setError(res.error ?? "Couldn't send test");
  };

  const copyLink = async () => {
    if (!pendingLink) return;
    try {
      await navigator.clipboard.writeText(pendingLink.link);
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
          <Send className="size-6 text-primary" /> Telegram
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Get your app notifications on your phone and message your AI team from
          Telegram — even when you're away from the dashboard.
        </p>
      </div>

      {error && (
        <div className="p-3 rounded-md bg-red-50 text-red-700 border border-red-200 text-sm">{error}</div>
      )}

      {!status?.configured && (
        <Card>
          <CardHeader>
            <CardTitle>Telegram isn't configured on this server yet</CardTitle>
            <CardDescription>
              The owner needs to add a <code>TELEGRAM_BOT_TOKEN</code> to the
              server environment, then reload this page.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {status?.configured && !status.connected && !pendingLink && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Link2 className="size-4" /> Connect Telegram
            </CardTitle>
            <CardDescription>
              Tap Connect, open the link on your phone, and tap <strong>Start</strong> in
              the chat with <strong>@{status.botUsername ?? "your bot"}</strong>. That binds
              your phone to this account.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={connect} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin mr-1" /> : <Link2 className="size-4 mr-1" />}
              Generate connect link
            </Button>
          </CardContent>
        </Card>
      )}

      {status?.configured && !status.connected && pendingLink && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Link2 className="size-4" /> One more step
            </CardTitle>
            <CardDescription>
              Open this link in Telegram on your phone and tap <strong>Start</strong>:
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded border bg-muted px-2 py-1.5 text-xs font-mono break-all">
                {pendingLink.link}
              </code>
              <Button variant="outline" size="sm" onClick={copyLink}>Copy</Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Link expires{" "}
              {new Date(pendingLink.expiresAt).toLocaleTimeString("en-US", {
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
              Chat {status.chatMasked} is linked to this account. Notifications
              mirror here automatically.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button onClick={test} disabled={busy} variant="outline">
                {busy ? <Loader2 className="size-4 animate-spin mr-1" /> : <Send className="size-4 mr-1" />}
                Send test notification
              </Button>
              <Button onClick={disconnect} disabled={busy} variant="destructive">
                <Unlink className="size-4 mr-1" /> Disconnect
              </Button>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="flex items-center gap-2">
                {status.alertOnly ? (
                  <BellOff className="size-4 text-muted-foreground" />
                ) : (
                  <Bell className="size-4 text-primary" />
                )}
                <div>
                  <p className="text-sm font-medium">Notifications</p>
                  <p className="text-xs text-muted-foreground">
                    {status.alertOnly
                      ? "Only approvals and alerts push to your phone"
                      : "All notifications push to your phone"}
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => toggleAlertOnly(!status.alertOnly)}
              >
                {status.alertOnly ? "All notifications" : "Alerts only"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
