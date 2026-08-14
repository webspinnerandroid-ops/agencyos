"use client";

import { useCallback, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { generateContentSchema, type GenerateContentInput } from "@/lib/validations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Copy, Check, Sparkles, FileText, Search, AlertTriangle } from "lucide-react";
import PostContent from "@/components/BlogContent";
import ScoreBadge from "@/components/ScoreBadge";

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

interface Client {
  id: string;
  name: string;
}

interface BlogImage {
  url: string;
  prompt: string;
  placement: "featured" | "inline";
  sectionTitle: string;
  description: string;
}

interface BlogPost {
  id: string;
  title: string;
  slug: string;
  metaDescription: string;
  headings: { level: number; text: string }[];
  body: string;
  wordCount?: number;
  suggestedImagePrompt?: string;
  images?: BlogImage[];
  status: string;
}

interface SocialPost {
  platform: string;
  id?: string;
  caption: string;
  hashtags: string[];
  firstComment: string;
  contentWarnings: string[];
  suggestedImageDescription: string;
}

interface GenerateResponse {
  success: boolean;
  blogPost: BlogPost & {
    seo?: {
      score: number;
      grade: "red" | "yellow" | "green";
      keyword: string;
      wordCount: number;
      checks: { id: string; label: string; category: string; maxPoints: number; earned: number; passed: boolean; detail: string }[];
    };
    research?: { questions: string[]; trends: string[]; source: "web" | "model" };
  };
  socialPosts: SocialPost[];
}

// ------------------------------------------------------------------
// Available platforms
// ------------------------------------------------------------------

const PLATFORMS = [
  { id: "instagram", label: "Instagram" },
  { id: "twitter", label: "Twitter / X" },
  { id: "linkedin", label: "LinkedIn" },
  { id: "facebook", label: "Facebook" },
  { id: "tiktok", label: "TikTok" },
  { id: "threads", label: "Threads" },
] as const;

// ------------------------------------------------------------------
// Helper: copy text to clipboard
// ------------------------------------------------------------------

function useCopy() {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, []);
  return { copied, copy };
}

// ------------------------------------------------------------------
// Page Component
// ------------------------------------------------------------------

export default function GeneratePage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<GenerateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [keywordsText, setKeywordsText] = useState("");
  const [imageCount, setImageCount] = useState(1);
  const { copied, copy } = useCopy();

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<GenerateContentInput>({
    resolver: zodResolver(generateContentSchema),
    defaultValues: {
      title: "",
      topic: "",
      brandVoice: "",
      // Blog-only by default — platforms are optional extras.
      platforms: [],
    },
  });

  // Fetch clients on mount
  const loadClients = useCallback(async () => {
    try {
      const res = await fetch("/api/clients", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setClients(data.clients ?? []);
      }
    } catch {
      // Silently fail — client selector is optional
    }
  }, []);

  // Load clients when the select opens
  const handleSelectOpen = useCallback(() => {
    if (clients.length === 0) {
      loadClients();
    }
  }, [clients.length, loadClients]);

  const onSubmit = async (data: GenerateContentInput) => {
    const keywords = keywordsText
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    if (!data.title && !data.topic && keywords.length === 0) {
      setError("Provide a title, keywords, or a topic to generate from.");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/generate-content", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, keywords, imageCount }),
      });

      const json = await res.json();

      if (!res.ok) {
        setError(json.error ?? "Generation failed");
        return;
      }

      setResult(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Generate Content</h1>
        <p className="text-muted-foreground mt-1">
          Create AI-powered blog posts and social media captions in seconds.
        </p>
      </div>

      {/* ---- Generation Form ---- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="size-5 text-primary" />
            New Blog Post
          </CardTitle>
          <CardDescription>
            Give a title, keywords, or a topic — we research what people are asking first, then write the post to answer it.
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit(onSubmit)}>
          <CardContent className="space-y-5">
            {/* Title OR keywords OR topic */}
            <div className="space-y-2">
              <Label htmlFor="title">Title (optional)</Label>
              <Input
                id="title"
                placeholder="e.g. Why Seasonal Coffee Menus Build Loyalty"
                disabled={loading}
                {...register("title")}
              />
              <p className="text-xs text-muted-foreground">
                Have a page title in mind? We&apos;ll write the post to satisfy it.
              </p>
              {errors.title && (
                <p className="text-sm text-destructive">{errors.title.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="keywords">Keywords / Topics (optional)</Label>
              <Input
                id="keywords"
                placeholder="seasonal coffee menu, coffee loyalty program, local roastery"
                disabled={loading}
                value={keywordsText}
                onChange={(e) => setKeywordsText(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Comma-separated. The first keyword is the focus keyword for SEO scoring.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="topic">Topic (optional)</Label>
              <Input
                id="topic"
                placeholder="Best social media strategies for 2026"
                disabled={loading}
                {...register("topic")}
              />
              {errors.topic && (
                <p className="text-sm text-destructive">{errors.topic.message}</p>
              )}
            </div>

            {/* Brand Voice */}
            <div className="space-y-2">
              <Label htmlFor="brandVoice">Brand Voice (optional)</Label>
              <Input
                id="brandVoice"
                placeholder="Professional, friendly, and approachable"
                disabled={loading}
                {...register("brandVoice")}
              />
            </div>

            {/* Images per blog */}
            <div className="space-y-2">
              <Label htmlFor="imageCount">Images in the post</Label>
              <select
                id="imageCount"
                value={imageCount}
                onChange={(e) => setImageCount(Number(e.target.value))}
                disabled={loading}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value={0}>None (text only)</option>
                <option value={1}>1 — featured image</option>
                <option value={2}>2 — featured + 1 inline</option>
                <option value={3}>3 — featured + 2 inline</option>
              </select>
              <p className="text-xs text-muted-foreground">
                Fewer images generates faster and costs less.
              </p>
            </div>

            {/* Client Selector (agency only) */}
            <div className="space-y-2">
              <Label htmlFor="clientId">Client (optional)</Label>
              <Controller
                name="clientId"
                control={control}
                render={({ field }) => (
                  <Select
                    value={field.value ?? ""}
                    onValueChange={(val) => field.onChange(val || undefined)}
                  >
                    <SelectTrigger
                      className="w-full"
                      onClick={handleSelectOpen}
                      disabled={loading}
                    >
                      <SelectValue placeholder="No client (agency content)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">No client</SelectItem>
                      {clients.map((client) => (
                        <SelectItem key={client.id} value={client.id}>
                          {client.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {errors.clientId && (
                <p className="text-sm text-destructive">
                  {errors.clientId.message}
                </p>
              )}
            </div>

            {/* Platforms — optional: blog is always generated */}
            <fieldset className="space-y-2">
              <Label>Social Platforms (optional)</Label>
              <p className="text-xs text-muted-foreground">
                Leave unselected for a blog-only post. Select platforms to also
                generate matching social captions.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <Controller
                  name="platforms"
                  control={control}
                  render={({ field }) => {
                    const selected = field.value ?? [];
                    return (
                    <>
                      {PLATFORMS.map((platform) => {
                        const checked = selected.includes(platform.id);
                        return (
                          <div
                            key={platform.id}
                            className="flex items-center gap-2"
                          >
                            <Checkbox
                              id={`platform-${platform.id}`}
                              checked={checked}
                              disabled={loading}
                              onCheckedChange={(val) => {
                                const updated = val
                                  ? [...selected, platform.id]
                                  : selected.filter(
                                      (p: string) => p !== platform.id
                                    );
                                field.onChange(updated);
                              }}
                            />
                            <Label
                              htmlFor={`platform-${platform.id}`}
                              className="cursor-pointer font-normal"
                            >
                              {platform.label}
                            </Label>
                          </div>
                        );
                      })}
                    </>
                    );
                  }}
                />
              </div>
              {errors.platforms && (
                <p className="text-sm text-destructive">
                  {errors.platforms.message}
                </p>
              )}
            </fieldset>
          </CardContent>
          <CardFooter className="flex-col gap-2 items-start">
            <Button type="submit" disabled={loading} className="w-full sm:w-auto">
              {loading ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="size-4" />
                  Generate Content
                </>
              )}
            </Button>
            {error && (
              <p className="text-sm text-destructive w-full">{error}</p>
            )}
          </CardFooter>
        </form>
      </Card>

      {/* ---- Results ---- */}
      {result && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
          <h2 className="text-2xl font-semibold tracking-tight">Generated Content</h2>

          {/* Blog Post Preview */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <FileText className="size-5 text-primary" />
                  Blog Post
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copy(result.blogPost.body)}
                >
                  {copied ? (
                    <>
                      <Check className="size-3.5" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="size-3.5" />
                      Copy Body
                    </>
                  )}
                </Button>
              </CardTitle>
              <CardDescription>
                Status:{" "}
                <span className="capitalize font-medium">
                  {result.blogPost.status}
                </span>
                {result.blogPost.wordCount != null && (
                  <>
                    {" "}&middot;{" "}
                    <span className="font-medium">
                      {result.blogPost.wordCount.toLocaleString()} words
                    </span>
                  </>
                )}
                {result.blogPost.seo && (
                  <span className="mt-1 inline-block">
                    <ScoreBadge score={result.blogPost.seo.score} />
                  </span>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Research summary — what people are asking */}
              {result.blogPost.research &&
                (result.blogPost.research.questions.length > 0 ||
                  result.blogPost.research.trends.length > 0) && (
                  <div className="rounded-md border bg-muted/40 p-3">
                    <div className="flex items-center gap-2 text-xs font-semibold mb-2">
                      <Search className="size-3.5 text-primary" />
                      Research: what people are asking
                      <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-background border">
                        {result.blogPost.research.source === "web"
                          ? "Live web search"
                          : "Model knowledge (no web key)"}
                      </span>
                    </div>
                    {result.blogPost.research.questions.length > 0 && (
                      <ul className="space-y-1">
                        {result.blogPost.research.questions.map((q, i) => (
                          <li key={i} className="text-xs text-muted-foreground flex gap-1.5">
                            <span className="text-primary">•</span>
                            {q}
                          </li>
                        ))}
                      </ul>
                    )}
                    {result.blogPost.research.trends.length > 0 && (
                      <p className="text-[11px] text-muted-foreground mt-2">
                        <span className="font-medium text-foreground">Trends reflected: </span>
                        {result.blogPost.research.trends.join(" · ")}
                      </p>
                    )}
                  </div>
                )}

              {/* SEO score checklist */}
              {result.blogPost.seo && (
                <details className="rounded-md border p-3">
                  <summary className="text-xs font-semibold cursor-pointer flex items-center gap-2">
                    <AlertTriangle className="size-3.5 text-amber-500" />
                    On-page SEO score — {result.blogPost.seo.score}/100
                    <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-muted">
                      focus keyword: “{result.blogPost.seo.keyword}”
                    </span>
                  </summary>
                  <ul className="mt-2 space-y-1.5">
                    {result.blogPost.seo.checks.map((c) => (
                      <li
                        key={c.id}
                        className={`text-xs flex items-start gap-2 ${
                          c.passed ? "text-muted-foreground" : "text-destructive"
                        }`}
                      >
                        <span>{c.passed ? "✓" : "✗"}</span>
                        <span>
                          <span className="font-medium">{c.label}</span>
                          <span className="block text-[11px] opacity-70">{c.detail}</span>
                        </span>
                        <span className="ml-auto shrink-0">
                          {c.earned}/{c.maxPoints}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              <div>
                <Label className="text-xs">Title</Label>
                <h3 className="text-lg font-semibold mt-0.5">
                  {result.blogPost.title}
                </h3>
              </div>
              <div>
                <Label className="text-xs">Slug</Label>
                <p className="text-sm text-muted-foreground font-mono mt-0.5">
                  {result.blogPost.slug}
                </p>
              </div>
              <div>
                <Label className="text-xs">Meta Description</Label>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {result.blogPost.metaDescription}
                </p>
              </div>

              {/* Headings outline */}
              {(result.blogPost.headings ?? []).length > 0 && (
                <div>
                  <Label className="text-xs">Heading Structure</Label>
                  <ul className="mt-1 space-y-0.5 pl-4 border-l-2 border-muted">
                    {result.blogPost.headings.map((h, i) => (
                      <li
                        key={i}
                        className="text-sm"
                        style={{
                          marginLeft: `${(h.level - 1) * 12}px`,
                          fontWeight: h.level <= 2 ? 600 : 400,
                        }}
                      >
                        <span className="text-xs text-muted-foreground mr-1">
                          H{h.level}
                        </span>
                        {h.text}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Body — rendered markdown so embedded images display */}
              <div>
                <Label className="text-xs">Body</Label>
                <div className="mt-1 p-4 rounded-md bg-muted/50 border max-h-96 overflow-y-auto">
                  <PostContent
                    content={result.blogPost.body}
                    markdown
                    className="text-sm"
                  />
                </div>
              </div>

              {/* Generated images — featured hero + inline section images */}
              {result.blogPost.images && result.blogPost.images.length > 0 ? (
                <div>
                  <Label className="text-xs">
                    Generated Images ({result.blogPost.images.length})
                  </Label>
                  <div className="mt-1 grid gap-3 sm:grid-cols-2">
                    {result.blogPost.images.map((img, i) => (
                      <div
                        key={i}
                        className="rounded-md border overflow-hidden"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={img.url}
                          alt={img.description || img.sectionTitle || "Generated image"}
                          className={`w-full object-cover ${
                            img.placement === "featured" ? "h-40" : "h-32"
                          }`}
                        />
                        <div className="p-2 space-y-1">
                          <span
                            className={`inline-block text-[10px] px-1.5 py-0.5 rounded-full capitalize ${
                              img.placement === "featured"
                                ? "bg-primary/10 text-primary"
                                : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {img.placement}
                          </span>
                          <p className="text-xs text-muted-foreground line-clamp-2">
                            {img.sectionTitle || img.prompt}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : result.blogPost.suggestedImagePrompt ? (
                <div>
                  <Label className="text-xs">Suggested Image Prompt</Label>
                  <p className="text-sm text-muted-foreground italic mt-0.5">
                    {result.blogPost.suggestedImagePrompt}
                  </p>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {/* Social Posts */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {result.socialPosts.map((post) => (
              <Card key={post.platform} className="h-full">
                <CardHeader>
                  <CardTitle className="flex items-center justify-between gap-2 text-base">
                    <span className="capitalize">{post.platform}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => copy(post.caption)}
                    >
                      {copied ? (
                        <Check className="size-3.5" />
                      ) : (
                        <Copy className="size-3.5" />
                      )}
                    </Button>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <Label className="text-xs">Caption</Label>
                    <p className="text-sm mt-0.5 whitespace-pre-wrap">
                      {post.caption}
                    </p>
                  </div>
                  {post.hashtags.length > 0 && (
                    <div>
                      <Label className="text-xs">Hashtags</Label>
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {post.hashtags.map((tag, i) => (
                          <span
                            key={i}
                            className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded"
                          >
                            #{tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {post.firstComment && (
                    <div>
                      <Label className="text-xs">First Comment</Label>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {post.firstComment}
                      </p>
                    </div>
                  )}
                  {post.suggestedImageDescription && (
                    <div>
                      <Label className="text-xs">Image Description</Label>
                      <p className="text-xs text-muted-foreground italic mt-0.5">
                        {post.suggestedImageDescription}
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}