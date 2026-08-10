"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

/**
 * global-error.tsx — catches errors thrown by the root layout.
 * Only renders when an error propagates all the way to the top.
 * Must be a Client Component and must define its own <html>/<body>.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Global error boundary caught:", error);
  }, [error]);

  return (
    <html lang="en" className="h-full">
      <body className="h-full">
        <div className="flex min-h-full flex-col items-center justify-center bg-zinc-50 px-6 dark:bg-zinc-950">
          <div className="w-full max-w-lg rounded-xl border border-zinc-200 bg-white p-8 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
              <AlertTriangle className="size-7 text-red-600 dark:text-red-400" />
            </div>

            <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
              Something went wrong
            </h1>

            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
              An unexpected error occurred. Your data is safe — please try
              again.
            </p>

            {error.digest && (
              <p className="mt-3 font-mono text-xs text-zinc-400">
                Digest: {error.digest}
              </p>
            )}

            <button
              onClick={reset}
              className="mt-6 inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              <RefreshCw className="size-4" />
              Try Again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}