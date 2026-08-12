"use client";

import { useEffect, useMemo, useState } from "react";
import {
  FileText,
  MessageCircle,
  Trash2,
  Clock,
  Search,
  SearchX,
} from "lucide-react";
import PublishButton from "@/components/PublishButton";
import PostDetailModal from "@/components/PostDetailModal";
import ScoreBadge from "@/components/ScoreBadge";
import {
  getPostPreview,
  getSeoScore,
  statusBadgeClass,
  formatShortDate,
  type PostRow,
} from "@/lib/post-preview";

type SortKey = "newest" | "oldest" | "az" | "za";

export default function PostsList({ posts }: { posts: PostRow[] }) {
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sort, setSort] = useState<SortKey>("newest");
  const [selectedPost, setSelectedPost] = useState<PostRow | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletedIds, setDeletedIds] = useState<string[]>([]);

  // Deep link from the AI team chat: /dashboard/posts?post={id} opens that
  // post's detail modal (Cheryl's "View draft" links land here).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const postId = params.get("post");
    if (postId) {
      const target = posts.find((p) => p.id === postId);
      if (target) setSelectedPost(target);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visiblePosts = posts.filter((p) => !deletedIds.includes(p.id));

  const usedTypes = useMemo(
    () =>
      Array.from(
        new Set(posts.map((p) => getPostPreview(p).type).filter((t) => t && t !== "unknown"))
      ).sort(),
    [posts]
  );
  const usedStatuses = useMemo(
    () => Array.from(new Set(posts.map((p) => p.status).filter(Boolean))).sort(),
    [posts]
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = visiblePosts.filter((p) => {
      const preview = getPostPreview(p);
      if (needle && !preview.title.toLowerCase().includes(needle)) return false;
      if (typeFilter !== "all" && preview.type !== typeFilter) return false;
      if (statusFilter !== "all" && p.status !== statusFilter) return false;
      return true;
    });
    return [...list].sort((a, b) => {
      const pa = getPostPreview(a);
      const pb = getPostPreview(b);
      switch (sort) {
        case "newest":
          return (b.created_at ?? "").localeCompare(a.created_at ?? "");
        case "oldest":
          return (a.created_at ?? "").localeCompare(b.created_at ?? "");
        case "az":
          return pa.title.localeCompare(pb.title);
        case "za":
          return pb.title.localeCompare(pa.title);
      }
    });
  }, [visiblePosts, q, typeFilter, statusFilter, sort]);

  const handleDelete = async (postId: string) => {
    if (!confirm("Delete this post? This cannot be undone.")) return;
    setDeletingId(postId);
    try {
      const res = await fetch(`/api/posts/${postId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) {
        setDeletedIds((prev) => [...prev, postId]);
      } else {
        alert("Failed to delete post. Please try again.");
      }
    } catch {
      alert("Network error. Please try again.");
    } finally {
      setDeletingId(null);
    }
  };

  const selectClass =
    "rounded-md border border-input bg-background px-3 py-2 text-sm";

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">All Content</h1>
          <p className="text-muted-foreground mt-1">
            Every blog post and social caption — {filtered.length} of {posts.length} shown.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search titles…"
              className="rounded-md border border-input bg-background pl-9 pr-3 py-2 text-sm w-52"
            />
          </div>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className={selectClass}
            aria-label="Filter by type"
          >
            <option value="all">All types</option>
            {usedTypes.map((t) => (
              <option key={t} value={t} className="capitalize">
                {t}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className={selectClass}
            aria-label="Filter by status"
          >
            <option value="all">All statuses</option>
            {usedStatuses.map((s) => (
              <option key={s} value={s} className="capitalize">
                {s.replace("_", " ")}
              </option>
            ))}
          </select>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className={selectClass}
            aria-label="Sort by"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="az">Title A → Z</option>
            <option value="za">Title Z → A</option>
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border bg-card p-12 text-center text-muted-foreground">
          <SearchX className="size-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No content matches your filters.</p>
          <button
            onClick={() => {
              setQ("");
              setTypeFilter("all");
              setStatusFilter("all");
            }}
            className="mt-3 text-sm text-primary underline hover:no-underline"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="rounded-lg border divide-y bg-card">
          {filtered.map((post) => {
            const preview = getPostPreview(post);
            return (
              <div
                key={post.id}
                className="flex items-center justify-between p-4 hover:bg-muted/30 transition-colors cursor-pointer"
                onClick={() => setSelectedPost(post)}
              >
                <div className="flex items-center gap-3 min-w-0">
                  {preview.type === "blog" ? (
                    <FileText className="size-4 text-primary shrink-0" />
                  ) : (
                    <MessageCircle className="size-4 text-blue-500 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate max-w-md">{preview.title}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-muted-foreground capitalize">{preview.type}</span>
                      {preview.platform && (
                        <span className="text-xs text-muted-foreground">• {preview.platform}</span>
                      )}
                      {post.ai_generated && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300">
                          AI
                        </span>
                      )}
                      {preview.type === "blog" && (
                        <ScoreBadge score={getSeoScore(post)} />
                      )}
                      {post.cms_published_at && (
                        <a
                          href={`/site/${post.cms_slug ?? ""}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 hover:underline"
                          title="Published to your website"
                        >
                          On site ↗
                        </a>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0" onClick={(e) => e.stopPropagation()}>
                  <PublishButton postId={post.id} postType={preview.type as "blog" | "social"} />
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full capitalize ${statusBadgeClass(post.status)}`}
                  >
                    {post.status}
                  </span>
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="size-3" />
                    {post.created_at
                      ? formatShortDate(post.created_at)
                      : post.scheduled_at
                        ? "Sched " + formatShortDate(post.scheduled_at)
                        : "Draft"}
                  </span>
                  <button
                    onClick={() => handleDelete(post.id)}
                    disabled={deletingId === post.id}
                    className="p-1.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-muted-foreground hover:text-red-600 transition-colors"
                    title="Delete post"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selectedPost && (
        <PostDetailModal
          post={selectedPost}
          onClose={() => setSelectedPost(null)}
          onDeleted={(id) => {
            setDeletedIds((prev) => [...prev, id]);
            setSelectedPost(null);
          }}
        />
      )}
    </div>
  );
}
