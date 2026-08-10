"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Send, Calendar } from "lucide-react";

interface PublishButtonProps {
  postId: string;
  postType: "blog" | "social";
  onPublished?: () => void;
}

export default function PublishButton({ postId, postType, onPublished }: PublishButtonProps) {
  const [showOptions, setShowOptions] = useState(false);
  const [platform, setPlatform] = useState(postType === "blog" ? "wordpress" : "all");
  const [action, setAction] = useState<"publish" | "draft" | "schedule">("publish");
  const [scheduledDate, setScheduledDate] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handlePublish = () => {
    startTransition(async () => {
      try {
        const res = await fetch("/api/publish", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            postId,
            platform,
            action,
            scheduledAt: action === "schedule" ? scheduledDate : undefined,
          }),
        });

        const data = await res.json();
        if (data.success) {
          setFeedback(`Published! ${data.message}`);
          onPublished?.();
        } else {
          // Surface per-platform failures so the user can see which one broke
          const failures = (data.results ?? [])
            .filter((r: any) => !r.success)
            .map((r: any) => `${r.platform ?? "wordpress"}: ${r.errorMessage ?? "unknown error"}`);
          const detail = failures.length > 0 ? ` (${failures.join("; ")})` : "";
          setFeedback(`Failed: ${data.message || "Unknown error"}${detail}`);
        }
      } catch (err: any) {
        setFeedback(err?.message || "Publish failed");
      }
    });
  };

  const platforms = postType === "blog"
    ? [{ id: "wordpress", name: "WordPress" }, { id: "all", name: "All Connected" }]
    : [
        { id: "instagram", name: "Instagram" },
        { id: "twitter", name: "X (Twitter)" },
        { id: "linkedin", name: "LinkedIn" },
        { id: "facebook", name: "Facebook" },
        { id: "tiktok", name: "TikTok" },
        { id: "all", name: "All Connected" },
      ];

  return (
    <div className="relative">
      {!showOptions ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() => setShowOptions(true)}
          disabled={isPending}
        >
          <Send className="size-3 mr-1" />
          Publish
        </Button>
      ) : (
        <div className="absolute right-0 top-0 z-50 w-64 p-4 rounded-lg border bg-card shadow-lg space-y-3">
          <div className="space-y-2">
            <Label className="text-xs">Platform</Label>
            <Select value={platform} onValueChange={setPlatform}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {platforms.map((p) => (
                  <SelectItem key={p.id} value={p.id} className="text-xs">
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Action</Label>
            <Select value={action} onValueChange={(v) => setAction(v as any)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="publish" className="text-xs">Publish Now</SelectItem>
                <SelectItem value="draft" className="text-xs">Save as Draft</SelectItem>
                <SelectItem value="schedule" className="text-xs">Schedule</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {action === "schedule" && (
            <div className="space-y-2">
              <Label className="text-xs"><Calendar className="size-3 inline mr-1" />Schedule Date</Label>
              <Input
                type="datetime-local"
                value={scheduledDate}
                onChange={(e) => setScheduledDate(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <Button size="sm" onClick={handlePublish} disabled={isPending} className="flex-1">
              {isPending ? <Loader2 className="size-3 animate-spin" /> : <Send className="size-3 mr-1" />}
              {action === "schedule" ? "Schedule" : "Publish"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowOptions(false)} disabled={isPending}>
              Cancel
            </Button>
          </div>

          {feedback && (
            <p className={`text-xs ${feedback.startsWith("Published") ? "text-green-600" : "text-red-600"}`}>
              {feedback}
            </p>
          )}
        </div>
      )}
    </div>
  );
}