import { Loader2 } from "lucide-react";

/**
 * loading.tsx — client portal segment loading fallback.
 */
export default function ClientPortalLoading() {
  return (
    <div className="flex flex-col items-center justify-center py-32">
      <Loader2 className="size-8 animate-spin text-[var(--client-primary)] mb-4" />
      <p className="text-sm text-muted-foreground">
        Loading client portal…
      </p>
    </div>
  );
}