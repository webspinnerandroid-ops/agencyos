"use client";

import { useState } from "react";
import Link from "next/link";
import { Brain, Download, CheckCircle2, Loader2, AlertTriangle } from "lucide-react";

export default function ExportDataPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("loading");
    setMessage("");
    try {
      const res = await fetch("/api/export-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus("error");
        setMessage(data.error ?? "Failed to submit your request. Please try again.");
        return;
      }
      setStatus("success");
      setMessage(data.message ?? "Your export is on its way.");
    } catch {
      setStatus("error");
      setMessage("A network error occurred. Please try again.");
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 flex items-center justify-between h-16">
          <Link href="/" className="flex items-center gap-2">
            <Brain className="size-6 text-primary" />
            <span className="text-xl font-bold tracking-tight">Agency OS</span>
          </Link>
          <Link href="/register" className="text-sm text-primary font-medium hover:underline">
            Start Free Trial
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-16">
        <div className="flex items-center gap-2">
          <Download className="size-6 text-primary" />
          <h1 className="text-3xl font-bold tracking-tight">Export My Data</h1>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">Last updated: August 2026</p>

        <p className="mt-6 text-muted-foreground leading-relaxed">
          Under data protection regulations you have the right to receive a copy
          of the personal data we hold about you in a portable, machine-readable
          format. Enter the email address on your account and we will email you
          a JSON archive of your data, including your profile, workspaces,
          content, media assets, audits, and knowledge base.
        </p>

        <h2 className="text-xl font-semibold mt-8">What&apos;s included</h2>
        <ul className="mt-3 space-y-2 text-muted-foreground leading-relaxed list-disc pl-5">
          <li>Your account profile and role assignments.</li>
          <li>
            Per workspace: clients, generated content, media assets (images,
            videos, brand assets, voice), SEO audits, and knowledge base items.
          </li>
          <li>
            The archive is emailed to the account address as a{" "}
            <code className="text-xs bg-muted px-1.5 py-0.5 rounded">.json</code>{" "}
            file you can keep or import elsewhere.
          </li>
        </ul>

        <div className="mt-10 rounded-lg border bg-card p-6">
          {status === "success" ? (
            <div className="flex items-start gap-3">
              <CheckCircle2 className="size-6 text-green-600 shrink-0" />
              <div>
                <p className="font-medium">Export requested</p>
                <p className="text-sm text-muted-foreground mt-1">{message}</p>
                <Link href="/" className="text-sm text-primary hover:underline mt-3 inline-block">
                  Back to home
                </Link>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="ex-email" className="block text-sm font-medium mb-1.5">
                  Account email
                </label>
                <input
                  id="ex-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </div>

              {status === "error" && (
                <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
                  <AlertTriangle className="size-4 shrink-0 mt-0.5" />
                  <span>{message}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={status === "loading"}
                className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
              >
                {status === "loading" ? (
                  <>
                    <Loader2 className="size-4 animate-spin mr-2" /> Preparing...
                  </>
                ) : (
                  <>
                    <Download className="size-4 mr-2" /> Email me my data
                  </>
                )}
              </button>
            </form>
          )}
        </div>

        <div className="mt-10 space-y-2 text-sm text-muted-foreground">
          <p>
            Questions? Contact{" "}
            <a href="mailto:support@blissmedialab.com" className="text-primary hover:underline">
              support@blissmedialab.com
            </a>
            .
          </p>
          <p>
            Read our{" "}
            <Link href="/privacy" className="text-primary hover:underline">
              Privacy Policy
            </Link>{" "}
            for full details on how we handle your data.
          </p>
        </div>
      </main>
    </div>
  );
}
