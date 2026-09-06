"use client";

import { useState, useTransition, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Send, Calendar, FolderTree, Globe } from "lucide-react";
import ConnectedSitesPublishDialog, {
  type PublishablePost,
  type SitePublishTarget,
} from "@/components/publish/ConnectedSitesPublishDialog";

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
  const [results, setResults] = useState<
    { platform: string; success: boolean; url?: string; message?: string; errorMessage?: string }[]
  >([]);
  const [isPending, startTransition] = useTransition();
  // Connected-sites publisher (create new OR overwrite existing post/page,
  // images included) — opened from a dedicated platform option for blog posts.
  const [connectedOpen, setConnectedOpen] = useState(false);
  const [connectedPost, setConnectedPost] = useState<PublishablePost | null>(null);
  // Super admin can publish to the marketing site's blog (/blog/<slug>).
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  // Resolve the role once so the Site Blog target only appears for super admins.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/session", { credentials: "include" });
        const data = await res.json();
        if (!cancelled) setIsSuperAdmin(data?.role === "super_admin");
      } catch {
        // no session info — hide the super-admin-only target
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // WordPress categories for the chosen site (fetched on open when publishing
  // to WordPress so the post lands in the right category, not Uncategorized).
  const [wpSites, setWpSites] = useState<
    {
      blogPlatformId: string;
      siteUrl: string;
      siteName: string;
      categories: { id: number; name: string; slug: string; count: number }[];
    }[]
  >([]);
  const [wpSiteId, setWpSiteId] = useState<string>("");
  const [wpCategoryId, setWpCategoryId] = useState<string>("");
  const [categoriesLoading, setCategoriesLoading] = useState(false);

  // Load categories once the options panel opens for a blog.
  useEffect(() => {
    if (!showOptions || postType !== "blog") return;
    let cancelled = false;
    setCategoriesLoading(true);
    (async () => {
      try {
        const res = await fetch("/api/wordpress/categories", { credentials: "include" });
        if (!cancelled && res.ok) {
          const data = await res.json();
          setWpSites(data.sites ?? []);
          if ((data.sites ?? []).length > 0) {
            setWpSiteId(data.sites[0].blogPlatformId);
            const cats = data.sites[0].categories ?? [];
            if (cats.length > 0) setWpCategoryId(String(cats[0].id));
          }
        }
      } catch {
        // Categories are a convenience — publish still works without them.
      } finally {
        if (!cancelled) setCategoriesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showOptions, postType]);

  const activeWpSite = wpSites.find((s) => s.blogPlatformId === wpSiteId);

  // Open the connected-sites publisher for this saved post: load its title +
  // images (the full content is rebuilt server-side by /api/publish), then
  // swap the small publish dialog for the shared connected-sites dialog.
  const openConnectedSites = async () => {
    try {
      const res = await fetch(`/api/posts/${postId}/publish-info`, {
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error ?? "Could not load post data");
      }
      setConnectedPost({
        title: data.title ?? "Untitled Post",
        body: "",
        images: Array.isArray(data.images) ? data.images : [],
      });
      setShowOptions(false);
      setConnectedOpen(true);
    } catch (err: any) {
      setFeedback(err?.message ?? "Could not load post data");
    }
  };

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
            // The datetime-local value is naive local wall time — tell the
            // server how far off UTC this browser is so the scheduled time
            // is stored as the correct UTC instant (the Inngest cron
            // publishes against UTC).
            tzOffsetMinutes:
              action === "schedule" ? new Date().getTimezoneOffset() : undefined,
            categoryId:
              platform === "wordpress" && wpCategoryId ? Number(wpCategoryId) : undefined,
          }),
        });

        const data = await res.json();
        setResults(data.results ?? []);
        if (data.success) {
          const urlResult = (data.results ?? []).find((r: any) => r.url);
          if (urlResult?.url) {
            const path = urlResult.url as string;
            setFeedback(
              path.startsWith("/blog/")
                ? `Published to the site blog — ${path}`
                : `Published to your website — ${path}`
            );
          } else {
            setFeedback(`Published! ${data.message}`);
          }
          onPublished?.();
        } else {
          // Surface the API's real error (the API sends `error`, not
          // `message` — reading the wrong field used to show a useless
          // "Unknown error" for every failure). Score-gate responses carry
          // the full explanation (gate vs score, auto-rewrite status).
          const apiError =
            (data as { error?: string }).error ??
            (data as { message?: string }).message ??
            "Publish failed";
          // Per-platform failures add detail on top of the API error.
          const failures = (data.results ?? [])
            .filter((r: any) => !r.success)
            .map((r: any) => `${r.platform ?? "wordpress"}: ${r.errorMessage ?? "unknown error"}`);
          const detail = failures.length > 0 ? ` (${failures.join("; ")})` : "";
          setFeedback(`Failed: ${apiError}${detail}`);
        }
      } catch (err: any) {
        setFeedback(err?.message || "Publish failed");
      }
    });
  };

  const platforms = postType === "blog"
    ? [
        { id: "cms", name: "Your Website (CMS)" },
        ...(isSuperAdmin
          ? [{ id: "site_blog", name: "Site Blog (/blog)" }]
          : []),
        { id: "wordpress", name: "WordPress" },
        { id: "connected_sites", name: "Connected Sites (create / overwrite)" },
        { id: "all", name: "All Connected" },
      ]
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
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setShowOptions(false)}
        >
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <div
            className="relative w-full max-w-sm p-4 rounded-lg border bg-card shadow-xl space-y-3 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Publish options</span>
              <button onClick={() => setShowOptions(false)} className="p-1 rounded hover:bg-muted text-muted-foreground" title="Close">
                ✕
              </button>
            </div>
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

          {platform === "connected_sites" ? (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Create a new post or overwrite an existing post/page on one or
                more connected WordPress sites — content and images replaced
                when selected.
              </p>
              <Button
                size="sm"
                className="w-full"
                onClick={openConnectedSites}
                disabled={isPending}
              >
                <Globe className="size-3 mr-1" /> Choose sites &amp; publish
              </Button>
            </div>
          ) : (
            <>
          {platform === "wordpress" && wpSites.length > 0 && (
            <div className="space-y-2">
              <Label className="text-xs">
                <FolderTree className="size-3 inline mr-1" />
                Category
              </Label>
              {categoriesLoading ? (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Loader2 className="size-3 animate-spin" /> Loading categories…
                </p>
              ) : (
                <>
                  {wpSites.length > 1 && (
                    <Select value={wpSiteId} onValueChange={(v) => {
                      setWpSiteId(v);
                      const site = wpSites.find((s) => s.blogPlatformId === v);
                      const cats = site?.categories ?? [];
                      setWpCategoryId(cats.length > 0 ? String(cats[0].id) : "");
                    }}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Site" />
                      </SelectTrigger>
                      <SelectContent>
                        {wpSites.map((s) => (
                          <SelectItem key={s.blogPlatformId} value={s.blogPlatformId} className="text-xs">
                            {s.siteName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {activeWpSite && activeWpSite.categories.length > 0 ? (
                    <Select value={wpCategoryId} onValueChange={setWpCategoryId}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                      <SelectContent>
                        {activeWpSite.categories.map((c) => (
                          <SelectItem key={c.id} value={String(c.id)} className="text-xs">
                            {c.name} ({c.count})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      No categories found — the post will go to Uncategorized.
                    </p>
                  )}
                </>
              )}
            </div>
          )}

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
              <p className="text-[10px] text-muted-foreground">
                Shown in your local time — the post publishes at this instant
                wherever your audience is.
              </p>
            </div>
            )}
            </>
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

          {results.length > 0 && (
            <div className="space-y-1 border-t pt-2">
              {results.map((r) => (
                <div key={r.platform} className="flex items-center justify-between text-xs">
                  <span className="capitalize text-muted-foreground">{r.platform.replace("_", " ")}</span>
                  {r.success ? (
                    r.url ? (
                      <a
                        href={r.url.startsWith("/") || r.url.startsWith("http") ? r.url : `https://${r.url}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-green-600 hover:underline flex items-center gap-1"
                      >
                        Live link ↗
                      </a>
                    ) : (
                      <span className="text-green-600">{r.message ?? "OK"}</span>
                    )
                  ) : (
                    <span className="text-red-600 truncate max-w-[220px]" title={r.errorMessage ?? ""}>
                      {r.errorMessage ?? "Failed"}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
          </div>
        </div>
      )}
      {connectedPost && connectedOpen && (
        <ConnectedSitesPublishDialog
          post={connectedPost}
          onClose={() => {
            setConnectedOpen(false);
            setConnectedPost(null);
          }}
          onPublish={async (targets: SitePublishTarget[]) => {
            const res = await fetch("/api/publish", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                postId,
                platform: "connected_sites",
                targets,
              }),
            });
            const data = await res.json();
            if (!res.ok) {
              throw new Error(
                (data as { error?: string })?.error ?? "Publish failed"
              );
            }
            return {
              results: (data.results ?? []) as any[],
              message: data.message as string | undefined,
            };
          }}
          onPublished={() => onPublished?.()}
        />
      )}
    </div>
  );
}