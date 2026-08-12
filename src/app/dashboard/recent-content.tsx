"use client";

import { useState } from "react";
import { FileText, MessageCircle, Clock, Trash2 } from "lucide-react";
import PublishButton from "@/components/PublishButton";
import PostDetailModal from "@/components/PostDetailModal";
import ScoreBadge from "@/components/ScoreBadge";
import { getPostPreview, getSeoScore, statusBadgeClass, type PostRow } from "@/lib/post-preview";

export function RecentContentList({ posts: initialPosts }: { posts: PostRow[] }) {
  const [posts, setPosts] = useState<PostRow[]>(initialPosts);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selectedPost, setSelectedPost] = useState<PostRow | null>(null);

  // The dashboard list ships only lightweight fields (title/type/platform).
  // The modal lazy-loads the full post (including the possibly megabytes-large
  // body with embedded images) when opened.

  const handleDelete = async (postId: string) => {
    if (!confirm("Delete this post? This cannot be undone.")) return;
    setDeletingId(postId);
    try {
      const res = await fetch(`/api/posts/${postId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) {
        setPosts((prev) => prev.filter((p) => p.id !== postId));
      } else {
        alert("Failed to delete post. Please try again.");
      }
    } catch {
      alert("Network error. Please try again.");
    } finally {
      setDeletingId(null);
    }
  };

  if (!posts || posts.length === 0) {
    return (
      <div>
        <h2 className="text-xl font-semibold tracking-tight mb-4">Recent Content</h2>
        <div className="rounded-lg border bg-card p-12 text-center text-muted-foreground">
          <FileText className="size-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No content yet.</p>
          <p className="text-xs mt-1">Generated blog posts and social captions will appear here.</p>
          <a href="/dashboard/generate" className="inline-block mt-4 text-sm text-primary underline hover:no-underline">
            Generate your first post →
          </a>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-semibold tracking-tight">Recent Content</h2>
          <span className="text-sm text-muted-foreground">{posts.length} post{posts.length !== 1 ? "s" : ""}</span>
        </div>
        <a href="/dashboard/posts" className="text-sm text-primary underline hover:underline">View all →</a>
      </div>
      <div className="rounded-lg border divide-y">
        {posts.map((post) => {
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
                <span className={`text-[10px] px-2 py-0.5 rounded-full capitalize ${statusBadgeClass(post.status)}`}>
                  {post.status}
                </span>
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="size-3" />
                  {post.scheduled_at
                    ? new Date(post.scheduled_at).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
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
        <div className="p-3 text-center">
          <a href="/dashboard/generate" className="text-xs text-primary underline hover:no-underline">
            Generate more content →
          </a>
        </div>
      </div>

      {/* Detail Modal — lazy-loads the full post on open */}
      {selectedPost && (
        <PostDetailModal
          post={selectedPost}
          onClose={() => setSelectedPost(null)}
          onDeleted={(id) => {
            setPosts((prev) => prev.filter((p) => p.id !== id));
            setSelectedPost(null);
          }}
        />
      )}
    </div>
  );
}
