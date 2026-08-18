"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, FileText, Palette, Film } from "lucide-react";
import { RecentContentList } from "./recent-content";
import type { PostRow } from "@/lib/post-preview";

const STORAGE_KEY = "agency_os_dash_recents";

type SectionKey = "content" | "audits" | "images" | "brands" | "videos";

const SECTIONS: { key: SectionKey; label: string }[] = [
  { key: "content", label: "Content" },
  { key: "audits", label: "SEO Audits" },
  { key: "images", label: "Images" },
  { key: "brands", label: "Brand Assets" },
  { key: "videos", label: "Videos" },
];

interface DashAsset {
  id: string;
  url?: string | null;
  prompt: string;
  created_at: string;
  metadata?: {
    scores?: { seo?: number; aeo?: number; geo?: number };
    postId?: string;
  } | null;
}

export function DashboardRecents({
  posts,
  audits,
}: {
  posts: PostRow[];
  audits: any[];
}) {
  const [enabled, setEnabled] = useState<Record<SectionKey, boolean>>({
    content: true,
    audits: true,
    images: true,
    brands: true,
    videos: true,
  });
  const [hydrated, setHydrated] = useState(false);
  const [images, setImages] = useState<DashAsset[]>([]);
  const [brands, setBrands] = useState<DashAsset[]>([]);
  const [videos, setVideos] = useState<DashAsset[]>([]);
  const [loading, setLoading] = useState(true);

  // Load the user's display preference once on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Record<SectionKey, boolean>>;
        setEnabled((prev) => ({ ...prev, ...parsed }));
      }
    } catch {
      // ignore
    }
    setHydrated(true);
  }, []);

  const toggle = (key: SectionKey) => {
    setEnabled((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const loadRecents = useCallback(async () => {
    setLoading(true);
    try {
      const [imgRes, brandRes, vidRes] = await Promise.all([
        fetch("/api/assets?type=image&task=image_generation&limit=8", { credentials: "include" }),
        fetch("/api/assets?type=image&task=brand_design&limit=8", { credentials: "include" }),
        fetch("/api/assets?type=video&limit=5", { credentials: "include" }),
      ]);
      const toAssets = async (r: Response): Promise<DashAsset[]> => {
        if (!r.ok) return [];
        const data = await r.json();
        return data.assets ?? [];
      };
      setImages(await toAssets(imgRes));
      setBrands(await toAssets(brandRes));
      setVideos(await toAssets(vidRes));
    } catch {
      // recents are best-effort
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (hydrated) loadRecents();
  }, [hydrated, loadRecents]);

  const anyOn = SECTIONS.some((s) => enabled[s.key]);

  return (
    <div className="space-y-8">
      {/* Choose which recents to show */}
      <div className="rounded-lg border bg-card p-3 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground mr-1">Show on dashboard:</span>
        {SECTIONS.map((s) => (
          <label
            key={s.key}
            className="flex items-center gap-1.5 text-xs cursor-pointer select-none px-2 py-1 rounded-md border border-border hover:bg-muted transition-colors"
          >
            <input
              type="checkbox"
              checked={enabled[s.key]}
              onChange={() => toggle(s.key)}
              className="accent-primary"
            />
            {s.label}
          </label>
        ))}
      </div>

      {loading && anyOn ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid gap-8 lg:grid-cols-2 items-start">
          {enabled.content && (
            <div className="min-w-0">
              <RecentContentList posts={posts} />
            </div>
          )}

          {enabled.audits && (
            <div className="min-w-0">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold tracking-tight">Recent SEO Audits</h2>
                <a href="/dashboard/seo/campaigns" className="text-sm text-primary underline hover:underline">View all →</a>
              </div>
              {audits && audits.length > 0 ? (
                <div className="rounded-lg border divide-y">
                  {(audits as any[]).map((a) => (
                    <a
                      key={a.id}
                      href={`/dashboard/seo/campaigns?open=${a.id}`}
                      className="flex items-center justify-between p-3 hover:bg-muted/30 transition-colors group"
                      title="Open this audit to start the campaign from it"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">
                          {String(a.url || "").replace(/^https?:\/\//, "").replace(/^www\./, "")}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-muted-foreground">{a.tier_name}</span>
                          <span className={"text-[10px] px-1.5 py-0.5 rounded-full capitalize " + (a.status === "proposed" ? "bg-blue-100 text-blue-700" : "bg-green-100 text-green-700")}>
                            {a.status}
                          </span>
                        </div>
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {a.tier_price == null || a.tier_price === 0 || String(a.tier_name ?? "").toLowerCase().includes("custom")
                          ? "Custom Consult"
                          : "$" + a.tier_price.toLocaleString() + "/mo"}
                      </span>
                    </a>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border bg-card p-8 text-center text-muted-foreground">
                  <p className="text-sm">No audits yet.</p>
                </div>
              )}
            </div>
          )}

          {enabled.images && (
            <div className="min-w-0">
              <RecentAssetSection
                title="Recent Images"
                icon={<FileText className="size-4 text-primary" />}
                viewAllHref="/dashboard/generate-images"
                emptyText="No images generated yet."
                assets={images}
              />
            </div>
          )}

          {enabled.brands && (
            <div className="min-w-0">
              <RecentAssetSection
                title="Recent Brand Assets"
                icon={<Palette className="size-4 text-primary" />}
                viewAllHref="/dashboard/assets"
                emptyText="No brand assets yet. Generate one from Brand & Vector Design."
                assets={brands}
              />
            </div>
          )}

          {enabled.videos && (
            <div className="min-w-0">
              <RecentAssetSection
                title="Recent Videos"
                icon={<Film className="size-4 text-primary" />}
                viewAllHref="/dashboard/generate-videos"
                emptyText="No videos generated yet."
                assets={videos}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RecentAssetSection({
  title,
  icon,
  viewAllHref,
  emptyText,
  assets,
}: {
  title: string;
  icon: React.ReactNode;
  viewAllHref: string;
  emptyText: string;
  assets: DashAsset[];
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2">{icon} {title}</h2>
        <a href={viewAllHref} className="text-sm text-primary underline hover:underline">View all →</a>
      </div>
      {assets.length === 0 ? (
        <div className="rounded-lg border bg-card p-8 text-center text-muted-foreground">
          <p className="text-sm">{emptyText}</p>
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-3">
          {assets.map((a) => {
            const scores = a.metadata?.scores;
            return (
              <a
                key={a.id}
                href={a.metadata?.postId ? `/dashboard/posts?post=${a.metadata.postId}` : viewAllHref}
                className="rounded-lg border overflow-hidden group flex flex-col"
                title={a.prompt}
              >
                {a.url ? (
                  <img
                    src={a.url}
                    alt={a.prompt}
                    className="aspect-square w-full object-cover group-hover:opacity-90 transition-opacity"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                ) : (
                  <div className="aspect-square w-full bg-muted flex items-center justify-center text-muted-foreground">
                    <Film className="size-6 opacity-40" />
                  </div>
                )}
                {scores && (scores.seo != null || scores.aeo != null || scores.geo != null) && (
                  <div className="px-1.5 py-1 flex items-center gap-1 flex-wrap">
                    {scores.seo != null && (
                      <span className="text-[9px] px-1 py-0.5 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 font-medium">
                        SEO {scores.seo}
                      </span>
                    )}
                    {scores.aeo != null && (
                      <span className="text-[9px] px-1 py-0.5 rounded bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 font-medium">
                        AEO {scores.aeo}
                      </span>
                    )}
                    {scores.geo != null && (
                      <span className="text-[9px] px-1 py-0.5 rounded bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300 font-medium">
                        GEO {scores.geo}
                      </span>
                    )}
                  </div>
                )}
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
