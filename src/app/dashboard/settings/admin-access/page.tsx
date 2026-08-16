"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, ShieldCheck, LogIn } from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function AdminAccessSettingsPage() {
  const [allowed, setAllowed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: string; message: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/tenant/admin-access", { credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (res.ok && typeof data.allowed === "boolean") setAllowed(data.allowed);
    } catch {
      // ignore — show the default off state
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (next: boolean) => {
    setSaving(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/tenant/admin-access", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allowed: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFeedback({ type: "error", message: data.error ?? "Failed to update." });
      } else {
        setAllowed(next);
        setFeedback({
          type: "success",
          message: next
            ? "Admin assistance is ON — platform support can sign in to your panel to help."
            : "Admin assistance is OFF — platform support can no longer sign in.",
        });
      }
    } catch {
      setFeedback({ type: "error", message: "Network error — try again." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Admin Assistance</h1>
        <p className="text-muted-foreground mt-1">
          Choose whether platform support can sign in to your panel to help you.
        </p>
      </div>

      {feedback && (
        <div
          className={`p-3 rounded-md text-sm border ${
            feedback.type === "success"
              ? "bg-green-50 text-green-700 border-green-200"
              : "bg-red-50 text-red-700 border-red-200"
          }`}
          role="alert"
        >
          {feedback.message}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-primary" /> Allow admin login-as
          </CardTitle>
          <CardDescription>
            When ON, a platform super admin can use a &ldquo;Login as&hellip;&rdquo; button to enter
            this workspace&apos;s panel and fix things for you. Strictly one-way: they sign in as
            you, but you never gain super admin access, and only you can turn this off again.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!loaded ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="size-4 animate-spin" /> Loading…
            </div>
          ) : (
            <button
              type="button"
              role="switch"
              aria-checked={allowed}
              disabled={saving}
              onClick={() => void toggle(!allowed)}
              className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-colors disabled:opacity-50 w-full ${
                allowed
                  ? "border-green-300 bg-green-50"
                  : "border-input bg-card hover:bg-muted/40"
              }`}
            >
              <span
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  allowed ? "bg-green-500" : "bg-gray-300"
                }`}
              >
                <span
                  className={`inline-block size-4 transform rounded-full bg-white transition-transform ${
                    allowed ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </span>
              <span className="text-sm font-medium">
                {saving ? "Saving…" : allowed ? "Enabled — support can log in" : "Disabled — support cannot log in"}
              </span>
              <LogIn className="ml-auto size-4 text-muted-foreground" />
            </button>
          )}
          <p className="text-xs text-muted-foreground">
            This only opens the door for the platform super admin to enter your panel. It never
            grants you (or anyone else in your workspace) super admin powers.
          </p>
        </CardContent>
      </Card>

      <Button variant="outline" onClick={() => (window.location.href = "/dashboard/settings")}>
        ← Back to Settings
      </Button>
    </div>
  );
}
