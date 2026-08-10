import { Loader2 } from "lucide-react";

/**
 * loading.tsx — root segment loading fallback.
 * Rendered while the page/hierarchy below the root layout is resolving.
 */
export default function RootLoading() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 dark:bg-zinc-950">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="size-10 animate-spin text-primary" />
        <p className="text-sm font-medium text-muted-foreground">
          Loading Agency OS…
        </p>
      </div>
    </div>
  );
}