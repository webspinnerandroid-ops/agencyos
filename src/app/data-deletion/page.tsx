"use client";

import { useState } from "react";
import Link from "next/link";
import { Brain, Trash2, CheckCircle2, Loader2, AlertTriangle } from "lucide-react";

export default function DataDeletionPage() {
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">(
    "idle"
  );
  const [message, setMessage] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("loading");
    setMessage("");
    try {
      const res = await fetch("/api/data-deletion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, reason }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus("error");
        setMessage(data.error ?? "Failed to submit your request. Please try again.");
        return;
      }
      setStatus("success");
      setMessage(data.message ?? "Your request has been received.");
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
          <Trash2 className="size-6 text-primary" />
          <h1 className="text-3xl font-bold tracking-tight">Data Deletion Request</h1>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">Last updated: August 2026</p>

        <p className="mt-6 text-muted-foreground leading-relaxed">
          You have the right to request that your account and personal data be
          deleted from Agency OS. This includes your account information, any
          content you or your clients created, and your personal data held by
          the platform. We will process your request within 30 days and confirm
          by email.
        </p>

        <h2 className="text-xl font-semibold mt-8">How deletion works</h2>
        <ul className="mt-3 space-y-2 text-muted-foreground leading-relaxed list-disc pl-5">
          <li>
            Submit the form below with the email address on your account. We
            will verify ownership before deleting anything.
          </li>
          <li>
            Deletion removes your account, workspaces, clients, content, and
            associated data from the platform.
          </li>
          <li>
            Some data may be retained where required by law (for example,
            billing records), but it will no longer be used for any other
            purpose.
          </li>
          <li>
            If you are a signed-in user, you can also delete your account
            directly from your profile settings for immediate processing.
          </li>
        </ul>

        <div className="mt-10 rounded-lg border bg-card p-6">
          {status === "success" ? (
            <div className="flex items-start gap-3">
              <CheckCircle2 className="size-6 text-green-600 shrink-0" />
              <div>
                <p className="font-medium">Request received</p>
                <p className="text-sm text-muted-foreground mt-1">{message}</p>
                <Link href="/" className="text-sm text-primary hover:underline mt-3 inline-block">
                  Back to home
                </Link>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="dd-email" className="block text-sm font-medium mb-1.5">
                  Account email
                </label>
                <input
                  id="dd-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label htmlFor="dd-reason" className="block text-sm font-medium mb-1.5">
                  Reason (optional)
                </label>
                <textarea
                  id="dd-reason"
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Tell us why you'd like your data deleted..."
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-y"
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
                    <Loader2 className="size-4 animate-spin mr-2" /> Submitting...
                  </>
                ) : (
                  <>
                    <Trash2 className="size-4 mr-2" /> Request data deletion
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
