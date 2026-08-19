"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Loader2,
  Plus,
  Trash2,
  FileText,
  ExternalLink,
  Save,
  Eye,
  EyeOff,
  Upload,
  ArrowLeft,
  ImageIcon,
} from "lucide-react";
import { renderBlogBody } from "@/lib/blog-render";
import { formatShortDate } from "@/lib/post-preview";
import {
  deriveExcerpt,
  firstImageUrl,
  siteScoreBadgeClass,
  slugifyTitle,
  type SiteBlogPost,
} from "@/lib/site-blog";

type Editor = {
  id: string | null; // null = new post
  title: string;
  slug: string;
  excerpt: string;
  body: string;
  featuredImageUrl: string;
  status: "draft" | "published";
};

const EMPTY_EDITOR: Editor = {
  id: null,
  title: "",
  slug: "",
  excerpt: "",
  body: "",
  featuredImageUrl: "",
  status: "draft",
};

export default function SiteBlogAdminPage() {
  const [posts, setPosts] = useState<SiteBlogPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  // Asset-library picker for the featured image.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [libraryAssets, setLibraryAssets] = useState<{ id: string; url: string; thumbnail_url: string | null; prompt: string | null }[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);

  const show = (type: "success" | "error", message: string) => setFeedback({ type, message });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/site-blog", { credentials: "include" });
      const data = await res.json();
      if (!res.ok) {
        show("error", data.error ?? "Failed to load posts");
      } else {
        setPosts(data.posts ?? []);
      }
    } catch {
      show("error", "Failed to load posts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const patchEditor = (patch: Partial<Editor>) =>
    setEditor((prev) => (prev ? { ...prev, ...patch } : prev));

  const handleTitleChange = (title: string) => {
    // Auto-derive the slug only for a NEW post (keeps existing slugs stable).
    setEditor((prev) =>
      prev
        ? { ...prev, title, slug: prev.id ? prev.slug : slugifyTitle(title) || prev.slug }
        : prev
    );
  };

  const uploadFeaturedImage = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/cms/upload", { method: "POST", credentials: "include", body: fd });
      const data = await res.json();
      if (!res.ok) {
        show("error", data.error ?? "Upload failed");
        return;
      }
      patchEditor({ featuredImageUrl: data.url });
      show("success", "Image uploaded — it will be used as the featured image.");
    } catch {
      show("error", "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const savePost = async () => {
    if (!editor) return;
    if (!editor.title.trim()) {
      show("error", "Title is required.");
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      const payload = {
        title: editor.title.trim(),
        slug: editor.slug.trim() || slugifyTitle(editor.title),
        excerpt: editor.excerpt.trim(),
        body: editor.body,
        featuredImageUrl: editor.featuredImageUrl.trim(),
        status: editor.status,
      };
      const url = editor.id
        ? `/api/admin/site-blog/${editor.id}`
        : "/api/admin/site-blog";
      const res = await fetch(url, {
        method: editor.id ? "PATCH" : "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        show("error", data.error ?? "Failed to save post");
        return;
      }
      show(
        "success",
        editor.id
          ? "Post updated — saved changes are live."
          : `Post created${data.post?.status === "published" ? " and published" : " as a draft"}.`
      );
      await load();
      setEditor(null);
    } catch {
      show("error", "Failed to save post");
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (post: SiteBlogPost) => {
    const next = post.status === "published" ? "draft" : "published";
    const res = await fetch(`/api/admin/site-blog/${post.id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    const data = await res.json();
    if (!res.ok) {
      show("error", data.error ?? "Failed to update status");
      return;
    }
    show("success", next === "published" ? "Post published — live at /blog/" + post.slug : "Post moved back to draft.");
    await load();
  };

  const deletePost = async (post: SiteBlogPost) => {
    if (!confirm(`Delete "${post.title}"? This cannot be undone.`)) return;
    const res = await fetch(`/api/admin/site-blog/${post.id}`, { method: "DELETE", credentials: "include" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      show("error", data.error ?? "Failed to delete post");
      return;
    }
    show("success", "Post deleted.");
    if (editor?.id === post.id) setEditor(null);
    await load();
  };

  const openLibraryPicker = async () => {
    setPickerOpen(true);
    setLibraryError(null);
    setLibraryLoading(true);
    try {
      const res = await fetch("/api/assets?type=image&limit=60", { credentials: "include" });
      const data = await res.json();
      if (!res.ok) {
        setLibraryError(data.error ?? "Could not load the asset library.");
        return;
      }
      setLibraryAssets(data.assets ?? []);
    } catch {
      setLibraryError("Could not load the asset library.");
    } finally {
      setLibraryLoading(false);
    }
  };

  const startEdit = (post: SiteBlogPost) => {
    setEditor({
      id: post.id,
      title: post.title,
      slug: post.slug,
      excerpt: post.excerpt ?? "",
      body: post.body,
      featuredImageUrl: post.featured_image_url ?? "",
      status: post.status,
    });
    setShowPreview(false);
    setFeedback(null);
  };

  if (loading && posts.length === 0) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="size-8 animate-spin mr-3" /> Loading blog posts…
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <FileText className="size-7 text-primary" /> Site Blog
          </h1>
          <p className="text-muted-foreground mt-1">
            WordPress-style blog for the marketing site — posts live at{" "}
            <a href="/blog" target="_blank" rel="noreferrer" className="text-primary hover:underline">/blog</a>.
            Super admin only.
          </p>
        </div>
        <Button onClick={() => { setEditor({ ...EMPTY_EDITOR }); setShowPreview(false); setFeedback(null); }}>
          <Plus className="size-4 mr-1.5" /> New post
        </Button>
      </div>

      {feedback && (
        <div className={`p-3 rounded-md text-sm border ${feedback.type === "success" ? "bg-green-50 text-green-700 border-green-200" : "bg-red-50 text-red-700 border-red-200"}`} role="alert">
          {feedback.message}
          <button className="ml-3 underline text-xs" onClick={() => setFeedback(null)}>Dismiss</button>
        </div>
      )}

      {/* Editor */}
      {editor && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              {editor.id ? "Edit post" : "New post"}
            </CardTitle>
            <CardDescription>
              Excerpt + featured image appear on the /blog archive; the body renders on the post&apos;s own page.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Title *</Label>
                <Input value={editor.title} onChange={(e) => handleTitleChange(e.target.value)} placeholder="Post title" />
              </div>
              <div className="space-y-1.5">
                <Label>Slug</Label>
                <Input
                  value={editor.slug}
                  onChange={(e) => patchEditor({ slug: e.target.value.toLowerCase() })}
                  placeholder="auto-from-title"
                  disabled={!editor.id && !editor.title}
                />
                <p className="text-xs text-muted-foreground">Lowercase + dashes only. Auto-derives from the title for new posts.</p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Excerpt (shown on the archive card)</Label>
              <textarea
                value={editor.excerpt}
                onChange={(e) => patchEditor({ excerpt: e.target.value })}
                rows={2}
                placeholder="Leave blank to auto-derive from the body"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-y"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Featured image</Label>
              <div className="flex items-end gap-2">
                <Input
                  value={editor.featuredImageUrl}
                  onChange={(e) => patchEditor({ featuredImageUrl: e.target.value })}
                  placeholder="https://… (or upload below)"
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={openLibraryPicker}
                  title="Pick from the workspace asset library"
                >
                  <ImageIcon className="size-4" />
                  Library
                </Button>
                <label className="shrink-0 inline-flex items-center gap-1 text-sm px-3 py-2 rounded-md border cursor-pointer hover:bg-muted">
                  {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                  Upload
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (f) await uploadFeaturedImage(f);
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>
              {editor.featuredImageUrl && (
                <div className="rounded-md overflow-hidden border w-48">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={editor.featuredImageUrl} alt="Featured preview" className="w-full h-auto" />
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Body (markdown)</Label>
                <Button variant="ghost" size="sm" onClick={() => setShowPreview((v) => !v)}>
                  {showPreview ? <EyeOff className="size-3.5 mr-1" /> : <Eye className="size-3.5 mr-1" />}
                  {showPreview ? "Edit" : "Preview"}
                </Button>
              </div>
              {showPreview ? (
                <div className="rounded-md border p-4 bg-muted/20 min-h-40">
                  <h2 className="text-xl font-bold mb-2">{editor.title || "Untitled post"}</h2>
                  <div
                    className="prose prose-sm max-w-none [&_p]:my-3 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:mt-6 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6"
                    dangerouslySetInnerHTML={{ __html: renderBlogBody(editor.body) }}
                  />
                </div>
              ) : (
                <textarea
                  value={editor.body}
                  onChange={(e) => patchEditor({ body: e.target.value })}
                  rows={14}
                  placeholder={"## Heading\n\nWrite your post in markdown. ![alt text](image-url) embeds images."}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring resize-y"
                />
              )}
            </div>

            <div className="flex items-center gap-3">
              <Button
                variant={editor.status === "published" ? "secondary" : "default"}
                size="sm"
                onClick={() => patchEditor({ status: editor.status === "published" ? "draft" : "published" })}
                title="Toggle between published and draft"
              >
                {editor.status === "published" ? <Eye className="size-3.5 mr-1" /> : <EyeOff className="size-3.5 mr-1" />}
                {editor.status === "published" ? "Published — click to unpublish" : "Draft — click to publish"}
              </Button>
              <div className="ml-auto flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => setEditor(null)} disabled={saving}>
                  <ArrowLeft className="size-3.5 mr-1" /> Cancel
                </Button>
                <Button onClick={savePost} disabled={saving}>
                  {saving ? <Loader2 className="size-4 animate-spin mr-1.5" /> : <Save className="size-4 mr-1.5" />}
                  Save {editor.status === "published" ? "& publish" : "draft"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Post list */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">All posts ({posts.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {posts.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No posts yet — create your first one above.
            </p>
          ) : (
            posts.map((post) => (
              <div key={post.id} className="flex items-center gap-3 rounded-md border p-3">
                {post.featured_image_url ? (
                  <div className="w-16 h-12 rounded overflow-hidden bg-muted shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={post.featured_image_url} alt="" className="w-full h-full object-cover" />
                  </div>
                ) : (
                  <div className="w-16 h-12 rounded bg-muted shrink-0 flex items-center justify-center">
                    <FileText className="size-4 text-muted-foreground" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{post.title}</p>
                  <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                    <span className={`px-1.5 py-0.5 rounded-full capitalize ${post.status === "published" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>
                      {post.status}
                    </span>
                    <span>/blog/{post.slug}</span>
                    {post.published_at && <span>· {formatShortDate(post.published_at)}</span>}
                  </div>
                  {(post.seo_score != null || post.aeo_geo_score != null) && (
                    <div className="flex items-center gap-1.5 mt-1.5 text-xs">
                      {post.seo_score != null && (
                        <span className={`px-1.5 py-0.5 rounded-full font-semibold ${siteScoreBadgeClass(post.seo_score)}`}>
                          SEO {post.seo_score}
                        </span>
                      )}
                      {post.aeo_geo_score != null && (
                        <span className={`px-1.5 py-0.5 rounded-full font-semibold ${siteScoreBadgeClass(post.aeo_geo_score)}`}>
                          AEO/GEO {post.aeo_geo_score}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {post.status === "published" && (
                    <a href={`/blog/${post.slug}`} target="_blank" rel="noreferrer" className="p-2 rounded hover:bg-muted text-muted-foreground" title="View live">
                      <ExternalLink className="size-4" />
                    </a>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => toggleStatus(post)} title={post.status === "published" ? "Unpublish" : "Publish"}>
                    {post.status === "published" ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => startEdit(post)} title="Edit">
                    Edit
                  </Button>
                  <Button variant="ghost" size="sm" className="text-destructive" onClick={() => deletePost(post)} title="Delete">
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Asset-library picker modal for the featured image */}
      {pickerOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setPickerOpen(false)}
        >
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <div
            className="relative w-full max-w-2xl p-4 rounded-lg border bg-card shadow-xl max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold">Pick a featured image from your library</span>
              <button onClick={() => setPickerOpen(false)} className="p-1 rounded hover:bg-muted text-muted-foreground" title="Close">
                ✕
              </button>
            </div>
            {libraryError && <p className="text-red-500 text-sm mb-3">{libraryError}</p>}
            {libraryLoading ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground">
                <Loader2 className="size-6 animate-spin mr-2" /> Loading assets…
              </div>
            ) : libraryAssets.length === 0 ? (
              <p className="text-sm text-muted-foreground py-16 text-center">
                No images in this workspace&apos;s asset library yet. Generate some, or upload one directly above.
              </p>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 overflow-y-auto pr-1">
                {libraryAssets.map((asset) => (
                  <button
                    key={asset.id}
                    type="button"
                    onClick={() => {
                      patchEditor({ featuredImageUrl: asset.thumbnail_url || asset.url });
                      setPickerOpen(false);
                      show("success", "Featured image set from the library.");
                    }}
                    className="group relative aspect-video rounded-md overflow-hidden border hover:border-primary focus:outline-none focus:ring-2 focus:ring-ring bg-muted"
                    title={asset.prompt ?? asset.url}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={asset.thumbnail_url || asset.url} alt={asset.prompt ?? "Asset"} className="w-full h-full object-cover" />
                    <span className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
