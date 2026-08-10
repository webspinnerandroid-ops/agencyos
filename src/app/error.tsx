"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * error.tsx — root segment error boundary.
 * Catches errors thrown by any page or layout *below* the root layout
 * (i.e. everything inside <body>).  Does NOT catch root-layout errors —
 * those go to global-error.tsx.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Application error:", error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-6 dark:bg-zinc-950">
      <div className="w-full max-w-lg rounded-xl border border-zinc-200 bg-white p-8 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
          <AlertTriangle className="size-7 text-red-600 dark:text-red-400" />
        </div>

        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          Something went wrong
        </h1>

        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          {error.message || "An unexpected error occurred while loading this page."}
        </p>

        {error.digest && (
          <p className="mt-3 font-mono text-xs text-zinc-400">
            Digest: {error.digest}
          </p>
        )}

        <div className="mt-6 flex flex-col items-center gap-2 sm:flex-row sm:justify-center">
          <Button onClick={reset} className="gap-2">
            <RefreshCw className="size-4" />
            Try Again
          </Button>
          <Link
            href="/"
            className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50 h-9 px-4 py-2 transition-all"
          >
            <Home className="size-4" />
            Back to Home
          </Link>
        </div>
      </div>
    </div>
  );
}