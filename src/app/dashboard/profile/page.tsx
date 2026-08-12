"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Loader2, Gauge, AlertTriangle } from "lucide-react";
import Link from "next/link";

interface UsageMetric {
  metric: string;
  label: string;
  used: number;
  limit: number | null;
  percent: number | null;
  warning: boolean;
  blocked: boolean;
}

interface UsageData {
  trial: boolean;
  planId: string;
  periodStart: string;
  periodEnd: string | null;
  metrics: UsageMetric[];
  socialByPlatform: Record<string, number>;
}

export default function ProfilePage() {
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/usage", { credentials: "include" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "Failed to load usage");
        return;
      }
      setData(json);
    } catch (err: any) {
      setError(err.message ?? "Failed to load usage");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Gauge className="size-6 text-primary" /> Profile & Usage
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          See how much of your monthly allowance you&apos;ve used this billing cycle —
          the system stops generation automatically at your plan limit.
        </p>
      </div>

      {error && (
        <div className="p-3 rounded-md bg-red-50 text-red-700 border border-red-200 text-sm">{error}</div>
      )}

      {loading && (
        <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
      )}

      {data && (
        <>
          {/* Plan banner */}
          <Card>
            <CardContent className="pt-6 flex items-center justify-between flex-wrap gap-3">
              <div>
                <p className="text-sm text-muted-foreground">Current plan</p>
                <p className="text-xl font-bold capitalize">
                  {data.planId}
                  {data.trial && (
                    <span className="ml-2 text-xs font-normal px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                      Free trial
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Cycle: {new Date(data.periodStart).toLocaleDateString("en-US", { month: "long", day: "numeric" })}
                  {data.periodEnd
                    ? ` – ${new Date(data.periodEnd).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`
                    : " – end of month"}
                </p>
              </div>
              <Link href="/dashboard/billing">
                <Button variant="outline" size="sm">Manage plan & billing</Button>
              </Link>
            </CardContent>
          </Card>

          {/* Usage meters */}
          <div className="grid gap-4 sm:grid-cols-2">
            {data.metrics.map((m) => (
              <Card key={m.metric}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center justify-between gap-2">
                    {m.label}
                    {m.blocked && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300">
                        Limit reached
                      </span>
                    )}
                    {m.warning && !m.blocked && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                        Nearly out
                      </span>
                    )}
                  </CardTitle>
                  <CardDescription>
                    {m.limit != null
                      ? `${m.used} of ${m.limit} used this cycle`
                      : data.trial && (m.metric === "blog_posts" || m.metric === "image_generations" || m.metric === "video_generations")
                        ? "Limited to 1 per week during the trial"
                        : `${m.used} used`}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        m.blocked ? "bg-red-500" : m.warning ? "bg-amber-500" : "bg-emerald-500"
                      }`}
                      style={{ width: `${Math.min(100, m.percent ?? 0)}%` }}
                    />
                  </div>
                  {m.blocked && (
                    <p className="text-xs text-red-600 mt-2 flex items-center gap-1">
                      <AlertTriangle className="size-3" /> Generation is paused until the next billing cycle — upgrade to raise your limit.
                    </p>
                  )}
                  {m.warning && !m.blocked && (
                    <p className="text-xs text-amber-600 mt-2 flex items-center gap-1">
                      <AlertTriangle className="size-3" /> You&apos;re at {m.percent}% of this limit.
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Social platform breakdown */}
          <Card>
            <CardHeader>
              <CardTitle>Social posts by platform</CardTitle>
              <CardDescription>This cycle&apos;s social content split by destination.</CardDescription>
            </CardHeader>
            <CardContent>
              {Object.keys(data.socialByPlatform ?? {}).length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {Object.entries(data.socialByPlatform).map(([platform, count]) => (
                    <span key={platform} className="text-xs px-2 py-1 rounded-full bg-muted capitalize">
                      {platform === "twitter" ? "X" : platform}: {count}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No social posts generated yet this cycle.</p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
