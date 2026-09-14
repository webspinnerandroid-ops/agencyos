"use client";

import { ExternalLink } from "lucide-react";
import type { PublishHistoryEntry } from "@/lib/publish-history";

/**
 * Per-post publish history: shows the most recent successful publishes as
 * small "site ↗" links (live URL for connected sites, /site/<slug> for the
 * built-in CMS) alongside the existing "On site" badge. Renders nothing when
 * the post has no successful publishes with a URL.
 */
export default function PublishHistoryLinks({
  entries,
}: {
  entries: PublishHistoryEntry[];
}) {
  const live = entries.filter((e) => e.success && e.targetUrl);
  if (live.length === 0) return null;

  const visible = live.slice(0, 3);
  const more = live.length - visible.length;

  return (
    <span className="inline-flex items-center gap-1 flex-wrap">
      {visible.map((e, i) => {
        const label = e.siteName ?? e.platform ?? "Site";
        const title = `${label} — published ${e.attemptAt ? new Date(e.attemptAt).toLocaleString() : "recently"}`;
        return (
          <a
            key={`${e.postId}-${e.targetUrl}-${i}`}
            href={e.targetUrl ?? undefined}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 hover:underline"
            title={title}
          >
            {label}
            <ExternalLink className="size-2.5" />
          </a>
        );
      })}
      {more > 0 && (
        <span
          className="text-[10px] text-muted-foreground"
          title={live
            .slice(3)
            .map((e) => e.siteName ?? e.platform ?? "Site")
            .join(", ")}
        >
          +{more} more
        </span>
      )}
    </span>
  );
}