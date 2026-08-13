"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { MessagesSquare } from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Bot, ExternalLink, Settings2, X } from "lucide-react";
import { EmployeeAvatar } from "@/components/EmployeeAvatar";

import type { EmployeeConfig, TenantAiEmployee } from "@/lib/ai-team";
import {
  getTeamRoster,
  getEmployeeConfig,
  setEmployeeActive,
  setEmployeeConfig,
  setEmployeeHired,
} from "@/lib/ai-team";

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  built: { label: "Available", className: "bg-green-100 text-green-700" },
  partial: { label: "Partial", className: "bg-amber-100 text-amber-700" },
  planned: { label: "Planned", className: "bg-gray-100 text-gray-600" },
};

export default function AiTeamPage() {
  const [roster, setRoster] = useState<TenantAiEmployee[]>([]);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [isLoading, startLoading] = useTransition();
  const [, startTransition] = useTransition();
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [configuring, setConfiguring] = useState<TenantAiEmployee | null>(null);
  const [configForm, setConfigForm] = useState<EmployeeConfig>({
    customInstructions: "",
    guidelines: "",
    assets: "",
  });
  const [configLoading, setConfigLoading] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);

  const load = useCallback(() => {
    startLoading(async () => {
      const res = await getTeamRoster();
      if (res.success && res.data) setRoster(res.data);
      else setFeedback({ type: "error", message: res.error ?? "Failed to load AI team" });
    });
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleHired = (emp: TenantAiEmployee) => {
    setPendingKey(emp.key);
    setFeedback(null);
    startTransition(async () => {
      const res = await setEmployeeHired(emp.key, !emp.hired);
      if (res.success) { setFeedback({ type: "success", message: `${emp.name} ${emp.hired ? "removed from" : "added to"} your team` }); load(); }
      else setFeedback({ type: "error", message: res.error ?? "Failed to update" });
      setPendingKey(null);
    });
  };

  const openConfigure = async (emp: TenantAiEmployee) => {
    setConfiguring(emp);
    setConfigLoading(true);
    const res = await getEmployeeConfig(emp.key);
    if (res.success && res.data) setConfigForm(res.data);
    else setConfigForm({ customInstructions: "", guidelines: "", assets: "" });
    setConfigLoading(false);
  };

  const saveConfig = () => {
    if (!configuring) return;
    setConfigSaving(true);
    setFeedback(null);
    startTransition(async () => {
      const res = await setEmployeeConfig(configuring.key, configForm);
      if (res.success) {
        setFeedback({ type: "success", message: `${configuring.name}'s configuration saved` });
        setConfiguring(null);
      } else {
        setFeedback({ type: "error", message: res.error ?? "Failed to save configuration" });
      }
      setConfigSaving(false);
    });
  };

  const toggleActive = (emp: TenantAiEmployee) => {
    setPendingKey(emp.key);
    setFeedback(null);
    startTransition(async () => {
      const res = await setEmployeeActive(emp.key, !emp.active);
      if (res.success) { setFeedback({ type: "success", message: `${emp.name} ${emp.active ? "paused" : "activated"}` }); load(); }
      else setFeedback({ type: "error", message: res.error ?? "Failed to update" });
      setPendingKey(null);
    });
  };

  const hired = roster.filter((e) => e.hired);
  const notHired = roster.filter((e) => !e.hired);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center gap-8 justify-between rounded-lg border bg-card p-6">
        {/* Left column: title, text, button */}
        <div className="md:w-2/5 space-y-4">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Bot className="size-6 text-primary" /> AI Team
          </h1>
          <p className="text-muted-foreground">
            Your team of AI employees. Each one automates a function of your agency — hire
            the ones you need and open their tools from the card.
          </p>
          <a
            href="/dashboard/ai-team/chat"
            className="inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3 py-2 text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <MessagesSquare className="size-4" />
            Team Chat
          </a>
        </div>

        {/* Right column: team photo */}
        <div className="md:w-2/5 shrink-0">
          <img
            src="/team/team.png"
            alt="Your AI team"
            className="w-full h-auto rounded-lg border"
          />
        </div>
      </div>

      {feedback && (
        <div className={`p-3 rounded-md text-sm ${feedback.type === "success" ? "bg-green-50 text-green-700 border-green-200" : "bg-red-50 text-red-700 border-red-200"} border`}>
          {feedback.message}
        </div>
      )}

      {isLoading && roster.length === 0 ? (
        <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading your AI team…</div>
      ) : (
        <>
          {hired.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Bot className="size-5 text-primary" /> Hired ({hired.length})</CardTitle>
                <CardDescription>Active members of your AI team.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {hired.map((emp) => (
                    <EmployeeCard key={emp.key} emp={emp} pending={pendingKey === emp.key} onToggleHired={() => toggleHired(emp)} onToggleActive={() => toggleActive(emp)} onConfigure={() => openConfigure(emp)} />
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {notHired.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">Available ({notHired.length})</CardTitle>
                <CardDescription>Not on your team — hire them to bring them into your workflow.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {notHired.map((emp) => (
                    <EmployeeCard key={emp.key} emp={emp} pending={pendingKey === emp.key} onToggleHired={() => toggleHired(emp)} onToggleActive={undefined} onConfigure={() => openConfigure(emp)} />
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Configure dialog */}
      {configuring && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onClick={() => !configSaving && setConfiguring(null)}
        >
          <div
            className="bg-card border rounded-lg w-full max-w-lg max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="font-semibold tracking-tight flex items-center gap-2">
                <Settings2 className="size-4 text-primary" /> Configure {configuring.name}
              </h3>
              <button
                onClick={() => setConfiguring(null)}
                disabled={configSaving}
                className="p-1 rounded hover:bg-muted text-muted-foreground"
                title="Close"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="p-4 space-y-4 overflow-y-auto">
              <p className="text-xs text-muted-foreground">
                These instructions are merged into {configuring.name}&apos;s system prompt — they override the
                default persona. Use them to train the agent on your workflows, tone, and client rules.
              </p>
              {configLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
                  <Loader2 className="size-4 animate-spin" /> Loading configuration…
                </div>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <label className="block text-sm font-medium">Custom instructions</label>
                    <textarea
                      value={configForm.customInstructions}
                      onChange={(e) => setConfigForm((f) => ({ ...f, customInstructions: e.target.value }))}
                      rows={4}
                      placeholder="e.g. Always write in second person, lead with the pain point, never mention pricing..."
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-y"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-sm font-medium">Guidelines</label>
                    <textarea
                      value={configForm.guidelines}
                      onChange={(e) => setConfigForm((f) => ({ ...f, guidelines: e.target.value }))}
                      rows={3}
                      placeholder="e.g. Tone, approval flow, do's and don'ts for this role..."
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-y"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-sm font-medium">Assets & reference notes</label>
                    <textarea
                      value={configForm.assets}
                      onChange={(e) => setConfigForm((f) => ({ ...f, assets: e.target.value }))}
                      rows={3}
                      placeholder="e.g. Links to brand kit, style guide, past winning posts, client docs..."
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-y"
                    />
                  </div>
                </>
              )}
            </div>
            <div className="p-4 border-t flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfiguring(null)} disabled={configSaving}>
                Cancel
              </Button>
              <Button onClick={saveConfig} disabled={configLoading || configSaving}>
                {configSaving ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
                Save configuration
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EmployeeCard({
  emp,
  pending,
  onToggleHired,
  onToggleActive,
  onConfigure,
}: {
  emp: TenantAiEmployee;
  pending: boolean;
  onToggleHired: () => void;
  onToggleActive?: () => void;
  onConfigure: () => void;
}) {
  const badge = STATUS_BADGE[emp.status] ?? STATUS_BADGE.built;

  return (
    <div className="rounded-lg border p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-4 min-w-0">
          <EmployeeAvatar employeeKey={emp.key} name={emp.name} size={80} />
          <span className="text-lg font-bold truncate">{emp.name}</span>
        </div>
        <Badge className={badge.className}>{badge.label}</Badge>
      </div>
      <p className="text-sm font-semibold text-primary">{emp.role}</p>
      <p className="text-xs text-muted-foreground flex-1">{emp.description}</p>
      <p className="text-[10px] text-muted-foreground">
        <span className="font-semibold">Integrations:</span> {emp.integrations}
      </p>
      {/* Tool link + status — its own row so it never collides with the actions */}
      <div className="flex items-center gap-2 pt-1 flex-wrap">
        {emp.settingsHref && (
          <a
            href={emp.settingsHref}
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            title={`Open ${emp.name}'s tool page`}
          >
            Open tool <ExternalLink className="size-3" />
          </a>
        )}
        <div className="flex-1" />
        <Badge
          variant={emp.active ? "default" : "outline"}
          className={emp.active ? "" : "text-muted-foreground"}
        >
          {emp.active ? "Active" : "Paused"}
        </Badge>
      </div>
      {/* Actions — wrapping so every button stays clickable on any card width */}
      <div className="flex items-center gap-2 pt-1 flex-wrap">
        {onToggleActive && (
          <Button size="sm" variant="outline" onClick={onToggleActive} disabled={pending}>
            {pending ? <Loader2 className="size-3 animate-spin" /> : emp.active ? "Pause" : "Activate"}
          </Button>
        )}
        <Button size="sm" variant={emp.hired ? "ghost" : "default"} onClick={onToggleHired} disabled={pending}>
          {pending ? <Loader2 className="size-3 animate-spin" /> : emp.hired ? "Remove" : "Hire"}
        </Button>
        <Button size="sm" variant="outline" onClick={onConfigure} disabled={pending} title="Custom instructions, guidelines, and assets">
          <Settings2 className="size-3 mr-1" /> Configure
        </Button>
      </div>
    </div>
  );
}
