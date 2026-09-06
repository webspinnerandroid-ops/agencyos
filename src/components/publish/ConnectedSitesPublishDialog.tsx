"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  ExternalLink,
  Globe,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Search,
  Send,
  X,
} from "lucide-react";
interface BlogPlatform {
  id: string;
  site_url: string;
  site_name: string;
  platform_type: string;
}

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

export interface PublishableImage {
  url: string;
  alt?: string;
  placement?: "featured" | "inline";
  description?: string;
}

/** Content shape the dialog needs — same fields whether the post is a
 * freshly generated one (Generate Content page) or a saved `posts` row
 * (loaded via /api/posts/[id]/publish-info). */
export interface PublishablePost {
  title: string;
  body: string;
  slug?: string;
  metaDescription?: string;
  seoMeta?: Record<string, string | string[]>;
  images?: PublishableImage[];
}

export interface SitePublishTarget {
  blogPlatformId: string;
  mode: "create" | "overwrite";
  kind: "post" | "page";
  wpPostId?: number;
  includeImages: boolean;
}

export interface PublishResultRow {
  blogPlatformId?: string;
  siteName?: string;
  success: boolean;
  wpPostUrl?: string;
  errorMessage?: string;
}

export interface PublishOutcome {
  results: PublishResultRow[];
  message?: string;
}

interface SiteContentItem {
  id: number;
  title: string;
  link: string;
  slug: string;
  date: string | null;
}

interface SitePublishConfig {
  platform: BlogPlatform;
  include: boolean;
  mode: "create" | "overwrite";
  kind: "post" | "page";
  wpPostId: string | null;
  includeImages: boolean;
  search: string;
  items: SiteContentItem[];
  itemsLoading: boolean;
  itemsError: string | null;
}

interface ConnectedSitesPublishDialogProps {
  post: PublishablePost;
  onClose: () => void;
  /** Performs the actual publish (POST to whatever backend serves this
   * flow). Throws to surface an error; resolves with per-site results. */
  onPublish: (targets: SitePublishTarget[]) => Promise<PublishOutcome>;
  /** Called when every selected site succeeded. */
  onPublished?: () => void;
}

/**
 * Publish generated content to the connected WordPress sites, with CREATE
 * NEW and OVERWRITE EXISTING modes (posts OR pages), including optional
 * image upload/replacement. Shared by the Generate Content page (freshly
 * generated post) and the saved-post "Publish" flow (PublishButton), which
 * supply their own onPublish implementation.
 */
export default function ConnectedSitesPublishDialog({
  post,
  onClose,
  onPublish,
  onPublished,
}: ConnectedSitesPublishDialogProps) {
  const [platforms, setPlatforms] = useState<BlogPlatform[]>([]);
  const [platformsLoading, setPlatformsLoading] = useState(false);
  const [configs, setConfigs] = useState<SitePublishConfig[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [results, setResults] = useState<PublishResultRow[]>([]);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasImages = (post.images ?? []).length > 0;

  // Load connected sites the first time the dialog opens (it mounts on open).
  // Fetches the tenant-wide platform list (like the publish backend resolves
  // sites) so a site connected under any workspace shows up here. Note:
  // platformsLoading is deliberately NOT a dependency — including it would
  // make setPlatformsLoading(true) re-run this effect, whose cleanup cancels
  // the in-flight fetch, so the site list would never load.
  useEffect(() => {
    if (platforms.length > 0) return;
    let cancelled = false;
    setPlatformsLoading(true);
    (async () => {
      try {
        const res = await fetch("/api/wordpress/platforms", {
          credentials: "include",
        });
        const data = await res.json();
        if (!res.ok || !Array.isArray(data.platforms)) {
          if (!cancelled) setPlatforms([]);
          return;
        }
        if (cancelled) return;
        const list: BlogPlatform[] = data.platforms.map(
          (p: {
            id: string;
            siteUrl: string;
            siteName: string;
            platformType: string;
          }) => ({
            id: p.id,
            site_url: p.siteUrl,
            site_name: p.siteName,
            platform_type: p.platformType,
          })
        );
        setPlatforms(list);
        setConfigs(
          list.map((p) => ({
            platform: p,
            include: true,
            mode: "create" as const,
            kind: "post" as const,
            wpPostId: null,
            includeImages: hasImages,
            search: "",
            items: [],
            itemsLoading: false,
            itemsError: null,
          }))
        );
      } finally {
        if (!cancelled) setPlatformsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [platforms.length, hasImages]);

  const patchConfig = (platformId: string, patch: Partial<SitePublishConfig>) => {
    setConfigs((prev) =>
      prev.map((c) => (c.platform.id === platformId ? { ...c, ...patch } : c))
    );
  };

  // Load a site's existing posts/pages for the overwrite picker.
  const loadSiteContent = async (config: SitePublishConfig, search?: string) => {
    patchConfig(config.platform.id, { itemsLoading: true, itemsError: null });
    try {
      const query = new URLSearchParams({
        siteId: config.platform.id,
        kind: config.kind,
      });
      if (search) query.set("search", search);
      const res = await fetch(
        `/api/wordpress/site-content?${query.toString()}`,
        { credentials: "include" }
      );
      if (!res.ok) {
        patchConfig(config.platform.id, {
          itemsLoading: false,
          itemsError: "Could not reach this site — check its credentials.",
        });
        return;
      }
      const data = await res.json();
      const items: SiteContentItem[] = Array.isArray(data.items)
        ? data.items
        : [];
      patchConfig(config.platform.id, {
        items,
        itemsLoading: false,
        itemsError: null,
        // Auto-select the first match when nothing is picked yet.
        wpPostId:
          config.wpPostId ?? (items.length > 0 ? String(items[0].id) : null),
      });
    } catch {
      patchConfig(config.platform.id, {
        itemsLoading: false,
        itemsError: "Could not reach this site.",
      });
    }
  };

  const onSearchChange = (config: SitePublishConfig, value: string) => {
    patchConfig(config.platform.id, { search: value });
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      void loadSiteContent({ ...config, search: value }, value);
    }, 400);
  };

  const onKindChange = (config: SitePublishConfig, kind: "post" | "page") => {
    patchConfig(config.platform.id, { kind, wpPostId: null, search: "" });
    void loadSiteContent({ ...config, kind, wpPostId: null, search: "" });
  };

  useEffect(() => {
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, []);

  const handlePublish = async () => {
    const included = configs.filter((c) => c.include);
    if (included.length === 0) {
      setFeedback("Select at least one site to publish to.");
      return;
    }
    const missing = included.filter(
      (c) => c.mode === "overwrite" && !c.wpPostId
    );
    if (missing.length > 0) {
      setFeedback(
        `Pick an existing post/page to overwrite on: ${missing
          .map((c) => c.platform.site_name)
          .join(", ")}`
      );
      return;
    }

    setPublishing(true);
    setFeedback(null);
    setResults([]);
    try {
      const outcome = await onPublish(
        included.map((c) => ({
          blogPlatformId: c.platform.id,
          mode: c.mode,
          kind: c.kind,
          wpPostId: c.mode === "overwrite" ? Number(c.wpPostId) : undefined,
          includeImages: hasImages && c.includeImages,
        }))
      );
      setResults(outcome.results);
      setFeedback(outcome.message ?? null);
      if (outcome.results.length > 0 && outcome.results.every((r) => r.success)) {
        onPublished?.();
      }
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Publish failed");
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      onClick={() => !publishing && onClose()}
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-2xl p-5 rounded-lg border bg-card shadow-xl space-y-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold flex items-center gap-2">
              <Globe className="size-4 text-primary" />
              Publish to Connected Sites
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              &ldquo;{post.title}&rdquo; — create a new post on each site, or
              overwrite an existing post/page (content and images replaced
              when selected).
            </p>
          </div>
          <button
            onClick={() => !publishing && onClose()}
            className="p-1 rounded hover:bg-muted text-muted-foreground"
            title="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        {platformsLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
            <Loader2 className="size-4 animate-spin" /> Loading connected
            sites…
          </div>
        ) : platforms.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Globe className="size-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No connected sites yet.</p>
            <p className="text-xs mt-1">
              Connect one in Settings → Blog Platforms to publish from here.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {configs.map((config) => (
              <div
                key={config.platform.id}
                className={`rounded-md border p-3 space-y-3 ${
                  config.include ? "border-primary/40" : "opacity-60"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <label className="flex items-center gap-2 cursor-pointer min-w-0">
                    <input
                      type="checkbox"
                      checked={config.include}
                      disabled={publishing}
                      onChange={(e) =>
                        patchConfig(config.platform.id, {
                          include: e.target.checked,
                        })
                      }
                      className="size-4 accent-primary"
                    />
                    <span className="min-w-0">
                      <span className="text-sm font-medium block truncate">
                        {config.platform.site_name}
                      </span>
                      <span className="text-xs text-muted-foreground truncate block">
                        {config.platform.site_url}
                      </span>
                    </span>
                  </label>
                </div>

                {config.include && (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Action</Label>
                        <select
                          value={config.mode}
                          disabled={publishing}
                          onChange={(e) => {
                            const mode = e.target.value as
                              | "create"
                              | "overwrite";
                            patchConfig(config.platform.id, { mode });
                            // Load the site's existing posts immediately so
                            // the overwrite targets are visible right away
                            // (not hidden behind "type to search").
                            if (mode === "overwrite") {
                              void loadSiteContent({
                                ...config,
                                mode,
                                kind: config.kind,
                                search: "",
                              });
                            }
                          }}
                          className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm"
                        >
                          <option value="create">Create new post</option>
                          <option value="overwrite">Overwrite existing…</option>
                        </select>
                      </div>
                      {config.mode === "overwrite" && (
                        <div className="space-y-1">
                          <Label className="text-xs">Replace</Label>
                          <select
                            value={config.kind}
                            disabled={publishing}
                            onChange={(e) =>
                              onKindChange(
                                config,
                                e.target.value as "post" | "page"
                              )
                            }
                            className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm"
                          >
                            <option value="post">Posts (blog)</option>
                            <option value="page">Pages</option>
                          </select>
                        </div>
                      )}
                    </div>

                    {config.mode === "overwrite" && (
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2">
                          <div className="relative flex-1">
                            <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                            <input
                              type="text"
                              placeholder={`Search ${config.kind}s on this site…`}
                              value={config.search}
                              disabled={publishing}
                              onChange={(e) =>
                                onSearchChange(config, e.target.value)
                              }
                              className="w-full rounded-md border border-input bg-background pl-8 pr-2.5 py-1.5 text-sm"
                            />
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={publishing || config.itemsLoading}
                            onClick={() => loadSiteContent(config, config.search)}
                          >
                            {config.itemsLoading ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                              <RefreshCw className="size-3.5" />
                            )}
                          </Button>
                        </div>
                        {config.itemsLoading ? (
                          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                            <Loader2 className="size-3 animate-spin" />{" "}
                            Loading…
                          </p>
                        ) : config.itemsError ? (
                          <p className="text-xs text-destructive">
                            {config.itemsError}
                          </p>
                        ) : config.items.length === 0 ? (
                          <p className="text-xs text-muted-foreground">
                            No {config.kind}s found — type to search, or switch
                            to &ldquo;Create new post&rdquo;.
                          </p>
                        ) : (
                          <div className="space-y-1 max-h-40 overflow-y-auto rounded-md border">
                            {config.items.map((item) => (
                              <label
                                key={item.id}
                                className={`flex items-start gap-2 px-2.5 py-1.5 text-sm cursor-pointer hover:bg-muted ${
                                  String(config.wpPostId) === String(item.id)
                                    ? "bg-primary/10"
                                    : ""
                                }`}
                              >
                                <input
                                  type="radio"
                                  name={`overwrite-${config.platform.id}`}
                                  checked={
                                    String(config.wpPostId) === String(item.id)
                                  }
                                  disabled={publishing}
                                  onChange={() =>
                                    patchConfig(config.platform.id, {
                                      wpPostId: String(item.id),
                                    })
                                  }
                                  className="mt-0.5 size-3.5 accent-primary"
                                />
                                <span className="min-w-0">
                                  <span className="font-medium block truncate">
                                    {item.title}
                                  </span>
                                  <span className="text-[11px] text-muted-foreground">
                                    /{item.slug}
                                    {item.date
                                      ? ` · ${new Date(
                                          item.date
                                        ).toLocaleDateString()}`
                                      : ""}
                                  </span>
                                </span>
                              </label>
                            ))}
                          </div>
                        )}
                        <p className="text-[11px] text-amber-600">
                          Overwriting replaces this {config.kind}&apos;s content
                          {hasImages && config.includeImages
                            ? " and images"
                            : ""}
                        </p>
                      </div>
                    )}

                    {hasImages && (
                      <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={config.includeImages}
                          disabled={publishing}
                          onChange={(e) =>
                            patchConfig(config.platform.id, {
                              includeImages: e.target.checked,
                            })
                          }
                          className="size-4 accent-primary"
                        />
                        <ImageIcon className="size-3.5" />
                        Upload the {post.images?.length} generated image
                        {post.images?.length === 1 ? "" : "s"} to this site
                        (featured + inline)
                      </label>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 pt-1 border-t">
          <Button
            size="sm"
            onClick={handlePublish}
            disabled={publishing || platforms.length === 0}
            className="flex-1"
          >
            {publishing ? (
              <Loader2 className="size-3.5 animate-spin mr-1.5" />
            ) : (
              <Send className="size-3.5 mr-1.5" />
            )}
            {publishing
              ? "Publishing…"
              : `Publish to ${
                  configs.filter((c) => c.include).length
                } site${configs.filter((c) => c.include).length === 1 ? "" : "s"}`}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onClose}
            disabled={publishing}
          >
            Cancel
          </Button>
        </div>

        {feedback && (
          <p
            className={`text-xs ${
              feedback.includes("failed") || feedback.includes("Select")
                ? "text-destructive"
                : "text-green-600"
            }`}
          >
            {feedback}
          </p>
        )}

        {results.length > 0 && (
          <div className="space-y-1.5 border-t pt-2">
            {results.map((r) => (
              <div
                key={r.blogPlatformId ?? r.siteName ?? Math.random()}
                className="flex items-center justify-between text-xs"
              >
                <span className="font-medium truncate mr-2">
                  {r.siteName ?? "Site"}
                </span>
                {r.success ? (
                  r.wpPostUrl ? (
                    <a
                      href={r.wpPostUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-green-600 hover:underline flex items-center gap-1 shrink-0"
                    >
                      Live link <ExternalLink className="size-3" />
                    </a>
                  ) : (
                    <span className="text-green-600 shrink-0">Published</span>
                  )
                ) : (
                  <span
                    className="text-destructive truncate max-w-[260px]"
                    title={r.errorMessage ?? ""}
                  >
                    {r.errorMessage ?? "Failed"}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}