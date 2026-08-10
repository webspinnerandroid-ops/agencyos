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
import { Loader2, Copy, Check, Sparkles, FileText } from "lucide-react";

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

interface Client {
  id: string;
  name: string;
}

interface BlogPost {
  id: string;
  title: string;
  slug: string;
  metaDescription: string;
  headings: { level: number; text: string }[];
  body: string;
  wordCount?: number;
  suggestedImagePrompt: string;
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
  blogPost: BlogPost;
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
  const { copied, copy } = useCopy();

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<GenerateContentInput>({
    resolver: zodResolver(generateContentSchema),
    defaultValues: {
      topic: "",
      brandVoice: "",
      platforms: ["instagram"],
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
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/generate-content", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
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
            Enter a topic and choose the social platforms to generate content for.
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit(onSubmit)}>
          <CardContent className="space-y-5">
            {/* Topic */}
            <div className="space-y-2">
              <Label htmlFor="topic">Topic</Label>
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

            {/* Platforms */}
            <fieldset className="space-y-2">
              <Label>Social Platforms</Label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <Controller
                  name="platforms"
                  control={control}
                  render={({ field }) => (
                    <>
                      {PLATFORMS.map((platform) => {
                        const checked = field.value.includes(platform.id);
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
                                  ? [...field.value, platform.id]
                                  : field.value.filter(
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
                  )}
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
                    {result.blogPost.wordCount < 2500 && (
                      <span className="text-amber-500 ml-1" title="Below 2500 word minimum">
                        ⚠
                      </span>
                    )}
                    {result.blogPost.wordCount >= 2500 && (
                      <span className="text-green-500 ml-1" title="Meets 2500 word minimum">
                        ✓
                      </span>
                    )}
                  </>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
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
              {result.blogPost.headings.length > 0 && (
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

              {/* Body */}
              <div>
                <Label className="text-xs">Body</Label>
                <div className="mt-1 p-4 rounded-md bg-muted/50 border max-h-96 overflow-y-auto">
                  <div
                    className="prose prose-sm dark:prose-invert max-w-none"
                    dangerouslySetInnerHTML={{
                      __html: result.blogPost.body
                        .replace(/\n/g, "<br/>")
                        .replace(
                          /^### (.+)$/gm,
                          "<h3 class='text-base font-semibold mt-4 mb-1'>$1</h3>"
                        )
                        .replace(
                          /^## (.+)$/gm,
                          "<h2 class='text-lg font-bold mt-4 mb-1'>$1</h2>"
                        )
                        .replace(
                          /^# (.+)$/gm,
                          "<h1 class='text-xl font-bold mt-4 mb-1'>$1</h1>"
                        ),
                    }}
                  />
                </div>
              </div>

              <div>
                <Label className="text-xs">Suggested Image Prompt</Label>
                <p className="text-sm text-muted-foreground italic mt-0.5">
                  {result.blogPost.suggestedImagePrompt}
                </p>
              </div>
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