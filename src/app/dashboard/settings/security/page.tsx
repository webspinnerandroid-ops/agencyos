"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, ShieldCheck, ShieldOff, Copy, Check } from "lucide-react";
import QRCode from "qrcode";

type Phase = "loading" | "idle" | "setup" | "enabled";

export default function SecurityPage() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [qrUrl, setQrUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [otpauth, setOtpauth] = useState("");
  const [code, setCode] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [enrolledAt, setEnrolledAt] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/2fa/status", { credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.enrolled) {
        setPhase("enabled");
        setEnrolledAt(data.enrolledAt ?? null);
      } else {
        setPhase("idle");
      }
    } catch {
      setPhase("idle");
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const startSetup = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/2fa/setup", {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Failed to start setup");
        return;
      }
      setSecret(data.secret);
      setOtpauth(data.otpauthUri);
      try {
        const url = await QRCode.toDataURL(data.otpauthUri, { width: 220, margin: 1 });
        setQrUrl(url);
      } catch {
        setQrUrl("");
      }
      setPhase("setup");
    } catch (err: any) {
      setError(err.message ?? "Failed to start setup");
    } finally {
      setBusy(false);
    }
  };

  const confirmSetup = async () => {
    if (!/^\d{6}$/.test(code.trim())) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/2fa/verify", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim(), secret }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Verification failed");
        return;
      }
      setPhase("enabled");
      setEnrolledAt(new Date().toISOString());
      setCode("");
    } catch (err: any) {
      setError(err.message ?? "Verification failed");
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    if (!/^\d{6}$/.test(disableCode.trim())) {
      setError("Enter a current 6-digit code from your authenticator app.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/2fa/disable", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: disableCode.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Could not disable 2FA");
        return;
      }
      setPhase("idle");
      setDisableCode("");
    } catch (err: any) {
      setError(err.message ?? "Could not disable 2FA");
    } finally {
      setBusy(false);
    }
  };

  const copySecret = async () => {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <ShieldCheck className="size-6 text-primary" /> Security
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Two-factor authentication with any authenticator app (Google Authenticator,
          Authy, 1Password, etc.).
        </p>
      </div>

      {error && (
        <div className="p-3 rounded-md bg-red-50 text-red-700 border border-red-200 text-sm">{error}</div>
      )}

      {phase === "loading" && (
        <div className="flex justify-center py-12"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
      )}

      {phase === "idle" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ShieldOff className="size-4" /> Two-factor authentication is off</CardTitle>
            <CardDescription>
              Add an extra layer of security: after your password, you'll need a
              6-digit code from your phone.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={startSetup} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin mr-1" /> : <ShieldCheck className="size-4 mr-1" />}
              Enable two-factor
            </Button>
          </CardContent>
        </Card>
      )}

      {phase === "setup" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ShieldCheck className="size-4" /> Scan the QR code</CardTitle>
            <CardDescription>
              Open your authenticator app, scan the code, then enter the 6-digit code it shows.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-4 items-start">
              {qrUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={qrUrl} alt="Scan with your authenticator app" className="rounded-lg border p-2 bg-white w-44 h-44 object-contain" />
              ) : (
                <div className="w-44 h-44 rounded-lg border bg-muted flex items-center justify-center text-xs text-muted-foreground">
                  QR unavailable
                </div>
              )}
              <div className="flex-1 min-w-0">
                <Label className="text-xs">Manual entry key</Label>
                <div className="flex items-center gap-2 mt-1">
                  <code className="flex-1 rounded border bg-muted px-2 py-1.5 text-xs font-mono break-all">{secret}</code>
                  <button onClick={copySecret} className="p-1.5 rounded hover:bg-muted" title="Copy secret">
                    {copied ? <Check className="size-4 text-green-600" /> : <Copy className="size-4 text-muted-foreground" />}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Can't scan? Enter this key manually in your app, with issuer{" "}
                  <strong>Agency OS</strong> and your email.
                </p>
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-xs">6-digit code</Label>
              <div className="flex gap-2">
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  maxLength={6}
                  placeholder="000000"
                  className="w-40 font-mono text-center tracking-[0.4em]"
                />
                <Button onClick={confirmSetup} disabled={busy}>
                  {busy ? <Loader2 className="size-4 animate-spin" /> : "Verify & enable"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {phase === "enabled" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-green-600">
              <ShieldCheck className="size-4" /> Two-factor authentication is on
            </CardTitle>
            <CardDescription>
              {enrolledAt
                ? `Enabled ${new Date(enrolledAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}. You'll enter a code after your password at sign-in.`
                : "Your account requires a code after your password at sign-in."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Label className="text-xs">Enter a current code to disable</Label>
            <div className="flex gap-2">
              <Input
                value={disableCode}
                onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, ""))}
                maxLength={6}
                placeholder="000000"
                className="w-40 font-mono text-center tracking-[0.4em]"
              />
              <Button variant="destructive" onClick={disable} disabled={busy}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <ShieldOff className="size-4 mr-1" />}
                Disable 2FA
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
