"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  Plus,
  Trash2,
  Globe,
  Server,
  ArrowRight,
} from "lucide-react";

import type { BlogPlatform } from "./actions";
import {
  getSupportedBlogPlatforms,
  getBlogPlatforms,
  connectBlogPlatform,
  removeBlogPlatform,
} from "./actions";

// ------------------------------------------------------------------
// Form schema
// ------------------------------------------------------------------

const platformSchema = z.object({
  platformType: z.string().min(1, "Select a platform"),
  siteUrl: z.string().url("Enter a valid URL"),
  siteName: z.string().min(1, "Site name is required"),
  username: z.string().optional(),
  applicationPassword: z.string().optional(),
  apiKey: z.string().optional(),
  apiToken: z.string().optional(),
  adminApiKey: z.string().optional(),
  password: z.string().optional(),
});

type PlatformFormValues = z.infer<typeof platformSchema>;

// ------------------------------------------------------------------
// Page
// ------------------------------------------------------------------

export default function BlogPlatformsPage() {
  const [platforms, setPlatforms] = useState<BlogPlatform[]>([]);
  const [supportedPlatforms, setSupportedPlatforms] = useState<any[]>([]);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [isLoading, startLoading] = useTransition();
  const [isPending, startTransition] = useTransition();
  const [showForm, setShowForm] = useState(false);

  const {
    register,
    handleSubmit,
    reset: resetForm,
    setValue,
    watch,
    formState: { errors },
  } = useForm<PlatformFormValues>({
    resolver: zodResolver(platformSchema),
    defaultValues: {
      platformType: "",
      siteUrl: "",
      siteName: "",
    },
  });

  const selectedPlatform = watch("platformType");
  const selectedPlatformInfo = supportedPlatforms.find((p) => p.id === selectedPlatform);

  const loadData = useCallback(() => {
    startLoading(async () => {
      const [platRes, supportedRes] = await Promise.all([
        getBlogPlatforms(),
        getSupportedBlogPlatforms(),
      ]);
      if (platRes.success && platRes.data) setPlatforms(platRes.data);
      setSupportedPlatforms(supportedRes as any);
    });
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleConnect = (data: PlatformFormValues) => {
    const credentials: Record<string, string> = {};
    if (selectedPlatformInfo?.authMethod === "application_password") {
      if (data.username) credentials.username = data.username;
      if (data.applicationPassword) credentials.applicationPassword = data.applicationPassword;
    } else if (selectedPlatformInfo?.authMethod === "api_key") {
      if (data.apiKey) credentials.apiKey = data.apiKey;
      if (data.apiToken) credentials.apiToken = data.apiToken;
      if (data.adminApiKey) credentials.adminApiKey = data.adminApiKey;
    } else if (selectedPlatformInfo?.authMethod === "basic_auth") {
      if (data.username) credentials.username = data.username;
      if (data.password) credentials.password = data.password;
    } else if (selectedPlatformInfo?.authMethod === "oauth") {
      credentials.siteUrl = data.siteUrl;
    }

    startTransition(async () => {
      const res = await connectBlogPlatform(data.platformType, data.siteUrl, data.siteName, credentials);
      if (res.success) {
        resetForm();
        setShowForm(false);
        setFeedback({ type: "success", message: `${data.siteName} connected.` });
        loadData();
      } else {
        setFeedback({ type: "error", message: res.error ?? "Failed to connect." });
      }
    });
  };

  const handleRemove = (platformId: string, siteName: string) => {
    if (!confirm(`Remove "${siteName}"?`)) return;
    startTransition(async () => {
      const res = await removeBlogPlatform(platformId);
      if (res.success) {
        setFeedback({ type: "success", message: `${siteName} removed.` });
        loadData();
      } else {
        setFeedback({ type: "error", message: res.error ?? "Failed to remove." });
      }
    });
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Blog Platforms</h1>
          <p className="text-muted-foreground mt-1">
            Connect your blog platforms to publish content directly.
          </p>
        </div>
        <Button onClick={() => setShowForm(!showForm)} disabled={isPending}>
          {showForm ? "Cancel" : <><Plus className="size-4 mr-2" /> Connect Site</>}
        </Button>
      </div>

      {feedback && (
        <div className={`p-3 rounded-md text-sm font-medium ${
          feedback.type === "success"
            ? "bg-green-50 text-green-700 border border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800"
            : "bg-red-50 text-red-700 border border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800"
        }`} role="alert">
          {feedback.message}
          <button className="ml-3 underline text-xs" onClick={() => setFeedback(null)}>Dismiss</button>
        </div>
      )}

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Globe className="size-5 text-primary" />
              Connect Blog Platform
            </CardTitle>
            <CardDescription>
              Enter your site URL and authentication credentials. Credentials are encrypted at rest.
            </CardDescription>
          </CardHeader>
          <form onSubmit={handleSubmit(handleConnect)}>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="platformType">Platform Type</Label>
                <Select value={selectedPlatform} onValueChange={(v) => setValue("platformType", v)}>
                  <SelectTrigger disabled={isPending}>
                    <SelectValue placeholder="Choose platform type..." />
                  </SelectTrigger>
                  <SelectContent>
                    {supportedPlatforms.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        <span className="flex items-center gap-2">
                          <span>{p.icon}</span> {p.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.platformType && <p className="text-sm text-destructive">{errors.platformType.message}</p>}
                {selectedPlatformInfo && (
                  <p className="text-xs text-muted-foreground">{selectedPlatformInfo.description}</p>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="siteName">Site Name</Label>
                  <Input id="siteName" placeholder="My Blog" disabled={isPending} {...register("siteName")} />
                  {errors.siteName && <p className="text-sm text-destructive">{errors.siteName.message}</p>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="siteUrl">Site URL</Label>
                  <Input id="siteUrl" placeholder="https://mysite.com" disabled={isPending} {...register("siteUrl")} />
                  {errors.siteUrl && <p className="text-sm text-destructive">{errors.siteUrl.message}</p>}
                </div>
              </div>

              {selectedPlatformInfo?.authFields?.map((field: any) => (
                <div key={field.name} className="space-y-2">
                  <Label htmlFor={field.name}>{field.label}</Label>
                  <Input
                    id={field.name}
                    type={field.type}
                    placeholder={field.hint ?? ""}
                    disabled={isPending}
                    {...register(field.name as keyof PlatformFormValues)}
                  />
                  {field.hint && <p className="text-xs text-muted-foreground">{field.hint}</p>}
                </div>
              ))}
            </CardContent>
            <CardFooter>
              <Button type="submit" disabled={isPending}>
                {isPending ? <><Loader2 className="size-4 animate-spin mr-2" /> Connecting...</> : "Connect"}
              </Button>
            </CardFooter>
          </form>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="size-5 text-primary" />
            Connected Sites
          </CardTitle>
          <CardDescription>
            Blog platforms you've connected. Generated content can be published directly to these sites.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <Loader2 className="size-4 animate-spin" /> Loading...
            </div>
          ) : platforms.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Globe className="size-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No blog platforms connected yet.</p>
              <p className="text-xs mt-1">Click &ldquo;Connect Site&rdquo; to link your first blog.</p>
            </div>
          ) : (
            <div className="divide-y">
              {platforms.map((platform) => {
                const info = supportedPlatforms.find((p) => p.id === platform.platform_type);
                return (
                  <div key={platform.id} className="flex items-center justify-between py-4 gap-4 flex-wrap">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-2xl">{info?.icon ?? "🌐"}</span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{platform.site_name}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <Badge variant="outline" className="text-xs">{info?.name ?? platform.platform_type}</Badge>
                          <a href={platform.site_url} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1">
                            {platform.site_url} <ArrowRight className="size-3" />
                          </a>
                        </div>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-destructive shrink-0"
                      onClick={() => handleRemove(platform.id, platform.site_name)}
                      disabled={isPending}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}