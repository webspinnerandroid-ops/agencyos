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
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  Key,
  Eye,
  EyeOff,
  Trash2,
  Plus,
  Brain,
  Settings2,
} from "lucide-react";

import type {
  AiProvider,
  AiModel,
  TenantApiKey,
  TaskModelMapping,
  ValidTask,
} from "./actions";
import {
  getProviders,
  getModels,
  getTenantApiKeys,
  addApiKey,
  toggleApiKey,
  deleteApiKey,
  getTaskModelMappings,
  saveTaskModelMapping,
} from "./actions";

// ------------------------------------------------------------------
// Form schema
// ------------------------------------------------------------------

const apiKeySchema = z.object({
  providerId: z.string().min(1, "Select a provider"),
  apiKey: z.string().min(1, "API key is required"),
});

type ApiKeyFormValues = z.infer<typeof apiKeySchema>;

// ------------------------------------------------------------------
// Task labels (human-readable)
// ------------------------------------------------------------------

const TASK_LABELS: Record<ValidTask, string> = {
  blog_generation: "Blog Generation",
  social_caption: "Social Caption",
  image_generation: "Image Generation",
};

const ALL_TASKS: ValidTask[] = ["blog_generation", "social_caption", "image_generation"];

// ------------------------------------------------------------------
// Page
// ------------------------------------------------------------------

export default function AiSettingsPage() {
  const [providers, setProviders] = useState<AiProvider[]>([]);
  const [models, setModels] = useState<AiModel[]>([]);
  const [keys, setKeys] = useState<TenantApiKey[]>([]);
  const [mappings, setMappings] = useState<TaskModelMapping[]>([]);
  const [showKey, setShowKey] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [isLoadingData, startLoadingData] = useTransition();
  const [isPending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    reset: resetForm,
    setValue,
    watch,
    formState: { errors },
  } = useForm<ApiKeyFormValues>({
    resolver: zodResolver(apiKeySchema),
    defaultValues: { providerId: "", apiKey: "" },
  });

  const selectedProviderId = watch("providerId");

  // ------------------------------------------------------------------
  // Data loading
  // ------------------------------------------------------------------

  const loadData = useCallback(() => {
    startLoadingData(async () => {
      const [provRes, modelRes, keyRes, mapRes] = await Promise.all([
        getProviders(),
        getModels(),
        getTenantApiKeys(),
        getTaskModelMappings(),
      ]);

      if (provRes.success && provRes.data) setProviders(provRes.data);
      if (modelRes.success && modelRes.data) setModels(modelRes.data);
      if (keyRes.success && keyRes.data) setKeys(keyRes.data);
      if (mapRes.success && mapRes.data) setMappings(mapRes.data);
    });
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ------------------------------------------------------------------
  // Filter models by selected provider
  // ------------------------------------------------------------------

  const filteredModels = selectedProviderId
    ? models.filter((m) => m.provider_id === selectedProviderId)
    : models;

  // Group models by provider for task mapping dropdowns
  const modelsByProvider = models.reduce<
    Record<string, { providerName: string; models: AiModel[] }>
  >((acc, model) => {
    const pid = model.provider_id;
    if (!acc[pid]) {
      acc[pid] = {
        providerName: model.provider?.name ?? pid,
        models: [],
      };
    }
    acc[pid].models.push(model);
    return acc;
  }, {});

  // ------------------------------------------------------------------
  // Handlers
  // ------------------------------------------------------------------

  const onSubmitKey = (data: ApiKeyFormValues) => {
    startTransition(async () => {
      const res = await addApiKey(data.providerId, data.apiKey);
      if (res.success) {
        resetForm();
        setShowKey(false);
        setFeedback({ type: "success", message: "API key added successfully." });
        loadData();
      } else {
        setFeedback({ type: "error", message: res.error ?? "Failed to add key." });
      }
    });
  };

  const handleToggle = (keyId: string, currentActive: boolean) => {
    startTransition(async () => {
      const res = await toggleApiKey(keyId, !currentActive);
      if (res.success) {
        setFeedback({
          type: "success",
          message: `Key ${currentActive ? "deactivated" : "activated"}.`,
        });
        loadData();
      } else {
        setFeedback({ type: "error", message: res.error ?? "Toggle failed." });
      }
    });
  };

  const handleDelete = (keyId: string) => {
    if (!confirm("Are you sure you want to delete this API key?")) return;
    startTransition(async () => {
      const res = await deleteApiKey(keyId);
      if (res.success) {
        setFeedback({ type: "success", message: "API key deleted." });
        loadData();
      } else {
        setFeedback({ type: "error", message: res.error ?? "Delete failed." });
      }
    });
  };

  const handleMappingChange = (task: ValidTask, modelId: string) => {
    startTransition(async () => {
      const res = await saveTaskModelMapping(task, modelId);
      if (res.success) {
        setFeedback({ type: "success", message: `Mapping for "${TASK_LABELS[task]}" saved.` });
        loadData();
      } else {
        setFeedback({ type: "error", message: res.error ?? "Failed to save mapping." });
      }
    });
  };

  // Get current mapping for a task
  const getMappingForTask = (task: ValidTask) =>
    mappings.find((m) => m.task === task);

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">AI Settings</h1>
        <p className="text-muted-foreground mt-1">
          Manage your AI provider API keys and configure which models handle each
          content task.
        </p>
      </div>

      {/* Feedback toast */}
      {feedback && (
        <div
          className={`p-3 rounded-md text-sm font-medium ${
            feedback.type === "success"
              ? "bg-green-50 text-green-700 border border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800"
              : "bg-red-50 text-red-700 border border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800"
          }`}
          role="alert"
        >
          {feedback.message}
          <button
            className="ml-3 underline text-xs"
            onClick={() => setFeedback(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* ---- Add API Key ---- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="size-5 text-primary" />
            Add API Key
          </CardTitle>
          <CardDescription>
            Your key is encrypted before storage and never stored in plaintext.
            Each provider can have at most one active key.
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit(onSubmitKey)}>
          <CardContent className="space-y-4">
            {/* Provider selector */}
            <div className="space-y-2">
              <Label htmlFor="providerId">Provider</Label>
              <Select
                value={selectedProviderId}
                onValueChange={(val) => setValue("providerId", val)}
              >
                <SelectTrigger disabled={isPending}>
                  <SelectValue placeholder="Choose a provider...">
                    {selectedProviderId &&
                      providers.find((p) => p.id === selectedProviderId)?.name}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {providers.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.providerId && (
                <p className="text-sm text-destructive">
                  {errors.providerId.message}
                </p>
              )}
            </div>

            {/* API Key field (masked) */}
            <div className="space-y-2">
              <Label htmlFor="apiKey">API Key</Label>
              <div className="relative">
                <Input
                  id="apiKey"
                  type={showKey ? "text" : "password"}
                  placeholder="sk-..."
                  disabled={isPending}
                  className="pr-10"
                  {...register("apiKey")}
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowKey(!showKey)}
                  tabIndex={-1}
                  aria-label={showKey ? "Hide key" : "Show key"}
                >
                  {showKey ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </button>
              </div>
              {errors.apiKey && (
                <p className="text-sm text-destructive">
                  {errors.apiKey.message}
                </p>
              )}
            </div>
          </CardContent>
          <CardFooter>
            <Button type="submit" disabled={isPending || isLoadingData}>
              {isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Plus className="size-4" />
                  Add Key
                </>
              )}
            </Button>
          </CardFooter>
        </form>
      </Card>

      {/* ---- Saved Keys ---- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings2 className="size-5 text-primary" />
            Your API Keys
          </CardTitle>
          <CardDescription>
            Active keys are used for content generation. Inactive keys are
            ignored.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoadingData ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <Loader2 className="size-4 animate-spin" />
              Loading keys...
            </div>
          ) : keys.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">
              No API keys configured yet. Add one above to get started.
            </p>
          ) : (
            <div className="divide-y">
              {keys.map((key) => (
                <div
                  key={key.id}
                  className="flex items-center justify-between py-3 gap-4 flex-wrap"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Badge
                      variant={key.is_active ? "default" : "secondary"}
                      className="shrink-0"
                    >
                      {key.is_active ? "Active" : "Inactive"}
                    </Badge>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {key.provider?.name ?? "Unknown Provider"}
                      </p>
                      <p className="text-xs text-muted-foreground font-mono truncate">
                        {key.masked_key ?? "••••••••"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Added{" "}
                        {new Date(key.created_at).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <div className="flex items-center gap-2">
                      <Label
                        htmlFor={`active-${key.id}`}
                        className="text-xs cursor-pointer"
                      >
                        {key.is_active ? "Active" : "Inactive"}
                      </Label>
                      <Switch
                        id={`active-${key.id}`}
                        checked={key.is_active}
                        onCheckedChange={() =>
                          handleToggle(key.id, key.is_active)
                        }
                        disabled={isPending}
                      />
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => handleDelete(key.id)}
                      disabled={isPending}
                      aria-label="Delete key"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---- Task → Model Mapping ---- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="size-5 text-primary" />
            Task‑Model Mapping
          </CardTitle>
          <CardDescription>
            For each content task, choose which AI model should handle
            generation. Models shown are from all configured providers.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {ALL_TASKS.map((task) => {
            const currentMapping = getMappingForTask(task);

            return (
              <div
                key={task}
                className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4"
              >
                <Label className="w-40 shrink-0 text-sm font-medium capitalize">
                  {TASK_LABELS[task]}
                </Label>
                <Select
                  value={currentMapping?.model_id ?? ""}
                  onValueChange={(val) => handleMappingChange(task, val)}
                >
                  <SelectTrigger className="flex-1" disabled={isPending || models.length === 0}>
                    <SelectValue placeholder="Select a model...">
                      {currentMapping && (
                        <span className="text-sm">
                          {currentMapping.model?.model_identifier}{" "}
                          <span className="text-muted-foreground">
                            ({currentMapping.model?.provider?.name})
                          </span>
                        </span>
                      )}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {models.length === 0 && (
                      <div className="px-2 py-1.5 text-sm text-muted-foreground">
                        No models available — run the seed migration.
                      </div>
                    )}
                    {Object.entries(modelsByProvider).map(
                      ([providerId, group]) => (
                        <div key={providerId}>
                          <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                            {group.providerName}
                          </div>
                          {group.models.map((model) => (
                            <SelectItem key={model.id} value={model.id}>
                              {model.model_identifier}
                            </SelectItem>
                          ))}
                        </div>
                      )
                    )}
                  </SelectContent>
                </Select>
                {isPending && <Loader2 className="size-4 animate-spin shrink-0" />}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}