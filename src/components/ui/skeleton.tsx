import { cn } from "@/lib/utils";

/**
 * Skeleton — a lightweight placeholder for loading states.
 * Use with Tailwind classes to control size/styles.
 *
 * @example
 * <Skeleton className="h-4 w-48" />
 * <Skeleton className="h-10 w-full rounded-xl" />
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-muted", className)}
      aria-hidden="true"
    />
  );
}

/**
 * CardSkeleton — mimics a Card with header, body rows, and footer.
 * Perfect for page-level loading states while data is being fetched.
 */
export function CardSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="rounded-xl border bg-card p-6 space-y-5">
      <div className="space-y-2">
        <Skeleton className="h-5 w-1/3" />
        <Skeleton className="h-4 w-2/3" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-4">
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>
      <Skeleton className="h-9 w-28" />
    </div>
  );
}

/**
 * PageSkeleton — full‑page loading layout with heading + multiple card skeletons.
 */
export function PageSkeleton({
  title,
  cards = 3,
}: {
  title?: string;
  cards?: number;
}) {
  return (
    <div className="space-y-8 animate-in fade-in">
      {title ? (
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
          <Skeleton className="mt-2 h-4 w-72" />
        </div>
      ) : (
        <div className="space-y-2">
          <Skeleton className="h-9 w-56" />
          <Skeleton className="h-4 w-80" />
        </div>
      )}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: cards }).map((_, i) => (
          <CardSkeleton key={i} rows={3} />
        ))}
      </div>
    </div>
  );
}