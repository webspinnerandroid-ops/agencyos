"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import Link from "next/link";

interface Metric {
  metric: string;
  label: string;
  used: number;
  limit: number | null;
  percent: number | null;
  warning: boolean;
  blocked: boolean;
}

/**
 * Compact dashboard strip: warns when any usage metric is >= 80% of its
 * monthly (or weekly trial) allowance. Purely advisory — the API routes do
 * the hard enforcement.
 */
export function UsageBanner() {
  const [metrics, setMetrics] = useState<Metric[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/usage", { credentials: "include" })
      .then((r) => r.json().catch(() => null))
      .then((d) => {
        if (!cancelled && d?.metrics) setMetrics(d.metrics);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const flagged = (metrics ?? []).filter((m) => m.warning || m.blocked);
  if (flagged.length === 0) return null;

  return (
    <Link
      href="/dashboard/profile"
      className="block rounded-lg border border-amber-300/60 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 hover:border-amber-400 transition-colors"
    >
      <div className="flex items-center gap-2 text-sm font-medium text-amber-800 dark:text-amber-200">
        <AlertTriangle className="size-4 shrink-0" />
        Usage warning:{" "}
        {flagged
          .map((m) => `${m.label} ${m.blocked ? "at limit" : `${m.percent}%`}`)
          .join(" · ")}
      </div>
      <p className="text-xs text-amber-700/80 dark:text-amber-300/70 mt-0.5">
        Generation pauses automatically at your plan limit. See your allowance or upgrade on Profile &amp; Usage.
      </p>
    </Link>
  );
}
