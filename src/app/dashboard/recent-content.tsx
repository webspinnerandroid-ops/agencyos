"use client";

import { useState } from "react";
import { FileText, MessageCircle, Clock, Trash2, X, ImageIcon } from "lucide-react";
import PublishButton from "@/components/PublishButton";

interface Post {
  id: string;
  content: any;
  status: string;
  ai_generated?: boolean;
  scheduled_at: string | null;
  tier_level?: number | null;
}

function getPostPreview(post: Post) {
  const c = typeof post.content === "string" ? JSON.parse(post.content) : post.content;
  if (!c) return { title: "Untitled", type: "unknown", platform: "", body: "", suggestedImagePrompt: "" };
  return {
    title: c.title || c.caption?.substring(0, 80) || "Untitled",
    type: c.type || "unknown",
    platform: c.platform || "",
    body: c.body || c.content || c.caption || "",
    suggestedImagePrompt: c.suggestedImagePrompt || "",
  };
}

const statusColors: Record<string, string> = {
  draft: "bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300",
  published: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
  scheduled: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  failed: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  pending_approval: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
  approved: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
};

export function RecentContentList({ posts: initialPosts }: { posts: Post[] }) {
  const [posts, setPosts] = useState<Post[]>(initialPosts);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);

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
        <a href="/dashboard/calendar" className="text-sm text-primary underline hover:underline">View all →</a>
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
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0" onClick={(e) => e.stopPropagation()}>
                <PublishButton postId={post.id} postType={preview.type as "blog" | "social"} />
                <span className={`text-[10px] px-2 py-0.5 rounded-full capitalize ${statusColors[post.status] || "bg-gray-100 text-gray-600"}`}>
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

      {/* Detail Modal */}
      {selectedPost && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onClick={() => setSelectedPost(null)}
        >
          <div
            className="bg-card border rounded-lg w-full max-w-2xl max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="font-semibold tracking-tight">
                {(() => { const p = getPostPreview(selectedPost); return p.title; })()}
              </h3>
              <button
                onClick={() => setSelectedPost(null)}
                className="p-1 rounded hover:bg-muted text-muted-foreground"
                title="Close"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="p-4 space-y-4 overflow-y-auto">
              {/* Meta */}
              <div className="flex flex-wrap gap-2 text-xs">
                <span className={`px-2 py-0.5 rounded-full capitalize ${statusColors[selectedPost.status] || "bg-gray-100 text-gray-600"}`}>
                  {selectedPost.status}
                </span>
                {(() => { const p = getPostPreview(selectedPost); return p.type && <span className="px-2 py-0.5 rounded-full bg-muted text-muted-foreground capitalize">{p.type}</span>; })()}
                {selectedPost.ai_generated && (
                  <span className="px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300">AI Generated</span>
                )}
                {selectedPost.tier_level != null && (
                  <span className="px-2 py-0.5 rounded-full bg-muted text-muted-foreground">Tier {selectedPost.tier_level}</span>
                )}
              </div>

              {/* Scheduled */}
              {selectedPost.scheduled_at && (
                <div className="text-xs text-muted-foreground">
                  Scheduled: {new Date(selectedPost.scheduled_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
                </div>
              )}

              {/* Content */}
              <div>
                <h4 className="text-sm font-semibold mb-2">Content</h4>
                <div className="text-sm text-muted-foreground bg-muted/50 rounded-md p-3 whitespace-pre-wrap max-h-80 overflow-y-auto">
                  {getPostPreview(selectedPost).body || JSON.stringify(selectedPost.content, null, 2) || "No content"}
                </div>
              </div>

              {/* Raw JSON toggle for debugging/advanced */}
              <details>
                <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">View raw data</summary>
                <pre className="mt-2 text-[10px] bg-muted/40 rounded p-3 overflow-x-auto max-h-48">
                  {JSON.stringify(selectedPost.content, null, 2)}
                </pre>
              </details>

              {/* Suggested Image Prompt */}
              {getPostPreview(selectedPost).suggestedImagePrompt && (
                <div>
                  <h4 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                    <ImageIcon className="size-3.5" /> Suggested Image Prompt
                  </h4>
                  <p className="text-sm text-muted-foreground bg-purple-50 dark:bg-purple-950/50 rounded-md p-3 italic">
                    {getPostPreview(selectedPost).suggestedImagePrompt}
                  </p>
                </div>
              )}
            </div>
            <div className="p-4 border-t flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => { const id = selectedPost.id; setSelectedPost(null); handleDelete(id); }}
                disabled={deletingId === selectedPost.id}
                className="px-3 py-1.5 text-sm rounded-md border border-red-200 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
              >
                Delete
              </button>
              <PublishButton postId={selectedPost.id} postType={getPostPreview(selectedPost).type as "blog" | "social"} />
              <button
                onClick={() => setSelectedPost(null)}
                className="px-3 py-1.5 text-sm border rounded-md hover:bg-muted"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}