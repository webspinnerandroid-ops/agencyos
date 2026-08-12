"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Loader2, Clapperboard, Images } from "lucide-react";
import { getSiteSettings, updateSiteSettings } from "../actions";

export default function SiteSettingsPage() {
  const [mode, setMode] = useState<"slideshow" | "video">("slideshow");
  const [videoUrl, setVideoUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, startSaving] = useTransition();
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    getSiteSettings().then((r) => {
      if (r.success && r.data) {
        setMode(r.data.hero_mode);
        setVideoUrl(r.data.hero_video_url ?? "");
      } else if (r.error) {
        setFeedback({ type: "error", message: r.error });
      }
      setLoading(false);
    });
  }, []);

  const save = () => {
    startSaving(async () => {
      const r = await updateSiteSettings(mode, videoUrl);
      setFeedback(
        r.success
          ? { type: "success", message: "Saved. The public landing page will use the new hero." }
          : { type: "error", message: r.error ?? "Failed to save." }
      );
    });
  };

  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="size-8 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Website / Landing Page</h1>
        <p className="text-muted-foreground mt-1">Control what the public sales site shows in its product section.</p>
      </div>

      {feedback && (
        <div className={`p-3 rounded-md text-sm border ${feedback.type === "success" ? "bg-green-50 text-green-700 border-green-200" : "bg-red-50 text-red-700 border-red-200"}`}>
          {feedback.message}
          <button className="ml-3 underline text-xs" onClick={() => setFeedback(null)}>Dismiss</button>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><Clapperboard className="size-4 text-primary" /> Product tour media</CardTitle>
          <CardDescription>
            The landing page currently shows a screenshot slideshow. Switch it to a video whenever you have one — the video plays inline, the slideshow is kept as a fallback.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setMode("slideshow")}
              className={`rounded-xl border p-4 text-left transition-colors ${mode === "slideshow" ? "border-primary ring-2 ring-primary/30" : "hover:border-muted-foreground/40"}`}
            >
              <div className="flex items-center gap-2 font-medium">
                <Images className="size-4 text-primary" /> Slideshow
              </div>
              <p className="text-xs text-muted-foreground mt-1">Screenshot tour of the dashboard, generator, team chat, calendar &amp; more.</p>
            </button>
            <button
              type="button"
              onClick={() => setMode("video")}
              className={`rounded-xl border p-4 text-left transition-colors ${mode === "video" ? "border-primary ring-2 ring-primary/30" : "hover:border-muted-foreground/40"}`}
            >
              <div className="flex items-center gap-2 font-medium">
                <Clapperboard className="size-4 text-primary" /> Video
              </div>
              <p className="text-xs text-muted-foreground mt-1">Play an inline product walkthrough video instead.</p>
            </button>
          </div>

          {mode === "video" && (
            <div className="space-y-2">
              <Label htmlFor="videoUrl">Video URL</Label>
              <Input
                id="videoUrl"
                placeholder="https://example.com/agency-os-demo.mp4"
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                A direct .mp4 / .webm URL (self-hosted, Bunny CDN, or S3). YouTube/Vimeo links aren&apos;t supported yet.
              </p>
              {videoUrl && (
                <video
                  src={videoUrl}
                  controls
                  muted
                  playsInline
                  preload="metadata"
                  className="mt-2 w-full max-w-md rounded-lg border bg-black aspect-video"
                />
              )}
            </div>
          )}
        </CardContent>
        <CardFooter>
          <Button onClick={save} disabled={saving}>
            {saving ? <><Loader2 className="size-4 animate-spin mr-2" /> Saving...</> : "Save"}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
