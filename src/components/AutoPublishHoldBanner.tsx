"use client";

import { useEffect, useState } from "react";
import { Timer } from "lucide-react";

/**
 * Auto-publish hold banner — the 15-minute undo window shown wherever a
 * held post appears (Content Map rows, the posts list, the post detail
 * modal). Shows a live countdown and a Cancel button; cancelling keeps the
 * draft and only removes the automation.
 *
 * The expiry instant is authoritative from the DB (`posts.auto_publish_at`).
 * When the countdown hits zero this banner hides itself — the hold processor
 * takes over from there and the row/card flips to its scheduled state on the
 * next poll or reload.
 */
export default function AutoPublishHoldBanner({
  postId,
  autoPublishAt,
  scheduledAt,
  type,
  onCancel,
}: {
  postId: string;
  autoPublishAt: string;
  scheduledAt?: string | null;
  type: "blog" | "social";
  onCancel?: (postId: string) => void;
}) {
  // Force a re-render every second so the countdown ticks. `now` lives in
  // state (not the render body) to keep render pure.
  const [now, setNow] = useState(() => Date.now());
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => {
      setNow(Date.now());
      setTick((n) => n + 1);
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const msLeft = new Date(autoPublishAt).getTime() - now;
  if (msLeft <= 0) return null;
  const mins = Math.floor(msLeft / 60000);
  const secs = Math.floor((msLeft % 60000) / 1000);
  const target = type === "social" ? "social queues" : "WordPress";

  const cancel = async () => {
    setCancelling(true);
    setError(null);
    try {
      const res = await fetch(`/api/posts/${postId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel_auto_publish" }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? "Could not cancel.");
        setCancelling(false);
        return;
      }
      onCancel?.(postId);
    } catch {
      setError("Network error — please try again.");
      setCancelling(false);
    }
  };

  return (
    <div className="rounded-md border border-blue-500/40 bg-blue-500/10 px-2 py-1.5 flex flex-wrap items-center gap-2 text-[11px]">
      <Timer className="size-3 text-blue-600 dark:text-blue-400 shrink-0" />
      <span className="text-blue-700 dark:text-blue-300">
        Auto-publishing to {target} in {mins}:{String(secs).padStart(2, "0")}
        {scheduledAt
          ? ` — for ${new Date(scheduledAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })}`
          : ""}
      </span>
      <button
        onClick={cancel}
        disabled={cancelling}
        className="px-1.5 py-0.5 rounded border border-blue-400/60 text-blue-700 dark:text-blue-300 hover:bg-blue-500/20 disabled:opacity-50"
      >
        {cancelling ? "Cancelling…" : "Cancel"}
      </button>
      {error && <span className="text-destructive">{error}</span>}
    </div>
  );
}
