import { Loader2 } from "lucide-react";

/**
 * loading.tsx — dashboard segment loading fallback.
 * Displayed while a dashboard page (or its data) is being fetched.
 */
export default function DashboardLoading() {
  return (
    <div className="flex flex-col items-center justify-center py-32">
      <Loader2 className="size-8 animate-spin text-primary mb-4" />
      <p className="text-sm text-muted-foreground">Loading dashboard…</p>
    </div>
  );
}