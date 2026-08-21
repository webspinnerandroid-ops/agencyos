"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Check, ChevronRight, Loader2, MessageSquareText, Sparkles, ArrowLeft } from "lucide-react";
import { LIFECYCLE_STEPS } from "@/lib/lifecycle-steps";
import {
  advanceStep,
  announceGoLive,
  createPlanFromProposal,
  delegateToMalory,
  ensureClientWorkspace,
  getWizardData,
  type WizardData,
} from "./actions";

const CONNECTION_LABELS: Record<string, string> = {
  google_analytics: "Google Analytics (GA4)",
  search_console: "Google Search Console",
  google_drive: "Google Drive",
};

export default function OnboardingWizard({ initial }: { initial: WizardData }) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [selectedProposal, setSelectedProposal] = useState(
    initial.proposals[0]?.id ?? ""
  );
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const step = data.lifecycle.step;
  const completed = data.lifecycle.status === "completed";
  const current = LIFECYCLE_STEPS[Math.min(step, LIFECYCLE_STEPS.length - 1)];

  const run = (fn: () => Promise<unknown>, okText: string) => {
    startTransition(async () => {
      try {
        await fn();
        setFeedback({ ok: true, text: okText });
        const fresh = await getWizardData(data.client.id);
        setData(fresh);
      } catch (e) {
        setFeedback({ ok: false, text: e instanceof Error ? e.message : "Something went wrong" });
      }
    });
  };

  const completeStep = (stepId: string) =>
    run(() => advanceStep(data.client.id, stepId), "Step saved — moving on.");

  const delegate = (stepId: string) =>
    run(
      () => delegateToMalory(data.client.id, stepId),
      "Handed to Malory in the Team Room — watch the thread for her reply."
    );

  const connectionCount = data.connections.filter(
    (c) => c.provider === "google_analytics" || c.provider === "search_console" || c.provider === "google_drive"
  ).length;

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <Link href={`/dashboard/clients/${data.client.id}`}><Button variant="ghost" size="sm">
            <ArrowLeft className="size-3 mr-1" /> {data.client.name}
          </Button></Link>
        {completed ? (
          <Badge className="bg-green-600 text-white">Onboarding complete</Badge>
        ) : (
          <Badge variant="outline">
            Step {Math.min(step + 1, 6)} of 6
          </Badge>
        )}
      </div>

      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Sparkles className="size-5" /> Onboarding — {data.client.name}
        </h1>
        <p className="text-sm text-muted-foreground">
          {completed
            ? "Everything is set up. The campaign is live and Malory is coordinating the team."
            : "The wizard owns the plan; Malory can take over any step in the Team Room chat."}
        </p>
      </div>

      {/* Progress */}
      <div className="flex gap-1">
        {LIFECYCLE_STEPS.map((s, i) => {
          const done = completed || i < step || (i === step && data.lifecycle.status === "completed");
          const active = !completed && i === step;
          return (
            <div key={s.id} className="flex-1 space-y-1">
              <div
                className={`h-1.5 rounded-full ${
                  done ? "bg-primary" : active ? "bg-primary/60" : "bg-muted"
                }`}
              />
              <p className={`text-[10px] truncate ${active ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                {s.shortLabel}
              </p>
            </div>
          );
        })}
      </div>

      {feedback && (
        <p className={`text-xs ${feedback.ok ? "text-green-600" : "text-red-600"}`}>
          {feedback.text}
        </p>
      )}

      {completed ? (
        <Card>
          <CardContent className="py-10 text-center space-y-3">
            <Check className="size-10 mx-auto text-green-600" />
            <p className="font-medium">Onboarding complete — the client is live.</p>
            <p className="text-sm text-muted-foreground">
              Head to the calendar to manage the campaign, or chat with Malory to hand off work.
            </p>
            <div className="flex justify-center gap-2 pt-2">
              <Link href="/dashboard/calendar"><Button size="sm">Open Calendar</Button></Link>
              <Link href="/dashboard/ai-team/chat"><Button size="sm" variant="outline">Team Room</Button></Link>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">{current.label}</CardTitle>
            <CardDescription>{current.description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {current.id === "client_workspace" && (
              <div className="space-y-4">
                <div className="grid gap-2 text-sm">
                  <div className="flex justify-between border-b pb-2">
                    <span className="text-muted-foreground">Client</span>
                    <span className="font-medium">{data.client.name}</span>
                  </div>
                  <div className="flex justify-between border-b pb-2">
                    <span className="text-muted-foreground">Website</span>
                    <span className="font-medium">{data.client.website ?? "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Workspace</span>
                    {data.workspace ? (
                      <span className="font-medium flex items-center gap-1">
                        <Check className="size-3 text-green-600" /> {data.workspace.name}
                      </span>
                    ) : (
                      <span className="text-amber-600">Not created yet</span>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    disabled={isPending}
                    onClick={() => {
                      const finish = () =>
                        ensureClientWorkspace(data.client.id).then(() =>
                          advanceStep(data.client.id, "client_workspace", {
                            workspace_ready: true,
                          })
                        );
                      run(finish, "Workspace created — client confirmed.");
                    }}
                  >
                    {isPending ? <Loader2 className="size-4 animate-spin mr-1" /> : <Check className="size-4 mr-1" />}
                    {data.workspace ? "Confirm & continue" : "Create workspace & continue"}
                  </Button>
                  <Button size="sm" variant="outline" disabled={isPending} onClick={() => delegate(current.id)}>
                    <MessageSquareText className="size-4 mr-1" /> Ask Malory
                  </Button>
                </div>
              </div>
            )}

            {current.id === "connections" && (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  {["google_analytics", "search_console", "google_drive"].map((provider) => {
                    const connected = data.connections.some((c) => c.provider === provider);
                    return (
                      <div key={provider} className="flex items-center justify-between text-sm border-b pb-2">
                        <span>{CONNECTION_LABELS[provider] ?? provider}</span>
                        {connected ? (
                          <Badge className="bg-green-600 text-white text-[10px]">Connected</Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px]">Not connected</Badge>
                        )}
                      </div>
                    );
                  })}
                  <p className="text-xs text-muted-foreground pt-1">
                    {connectionCount >= 3
                      ? "All three tools are connected — audits and rankings will pull real data."
                      : "Missing connections limit audits and rankings. Open Connections to finish setup."}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link href="/dashboard/connections"><Button size="sm" variant="outline">Open Connections</Button></Link>
                  <Button size="sm" disabled={isPending} onClick={() => completeStep(current.id)}>
                    {isPending ? <Loader2 className="size-4 animate-spin mr-1" /> : <Check className="size-4 mr-1" />}
                    I&apos;ve connected the tools
                  </Button>
                  <Button size="sm" variant="outline" disabled={isPending} onClick={() => delegate(current.id)}>
                    <MessageSquareText className="size-4 mr-1" /> Ask Malory
                  </Button>
                </div>
              </div>
            )}

            {current.id === "brand_profile" && (
              <div className="space-y-4">
                {data.brandProfiles.length > 0 ? (
                  <div className="space-y-1.5">
                    {data.brandProfiles.map((p) => (
                      <div key={p.id} className="flex items-center justify-between text-sm border-b pb-2">
                        <span>{p.name}</span>
                        {p.is_default ? (
                          <Badge variant="outline" className="text-[10px]">Default</Badge>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No brand profile yet for this workspace — create one so the content team has a voice to write in.
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Link href={data.workspace ? `/dashboard/workspaces/${data.workspace.id}/brand-profile` : "/dashboard/workspaces"}>
                    <Button size="sm" variant="outline">
                      Open Brand Profile
                    </Button>
                  </Link>
                  <Button size="sm" disabled={isPending} onClick={() => completeStep(current.id)}>
                    {isPending ? <Loader2 className="size-4 animate-spin mr-1" /> : <Check className="size-4 mr-1" />}
                    Brand is set
                  </Button>
                  <Button size="sm" variant="outline" disabled={isPending} onClick={() => delegate(current.id)}>
                    <MessageSquareText className="size-4 mr-1" /> Ask Malory
                  </Button>
                </div>
              </div>
            )}

            {current.id === "content_plan" && (
              <div className="space-y-4">
                {data.plans.length > 0 ? (
                  <div className="space-y-1.5">
                    {data.plans.map((p) => (
                      <div key={p.id} className="flex items-center justify-between text-sm border-b pb-2">
                        <span>{p.title}</span>
                        <Badge variant="outline" className="text-[10px]">{p.status}</Badge>
                      </div>
                    ))}
                    <p className="text-xs text-muted-foreground">Plans appear as proposed items on the calendar.</p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No plan yet. Seed it from an approved proposal (exactly what was sold) or let Malory draft one.
                  </p>
                )}

                {data.proposals.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium">Approved proposals</p>
                    <select
                      value={selectedProposal}
                      onChange={(e) => setSelectedProposal(e.target.value)}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      {data.proposals.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.tier_name ?? "Proposal"} ({p.status})
                        </option>
                      ))}
                    </select>
                    <Button
                      size="sm"
                      disabled={isPending || !selectedProposal}
                      onClick={() =>
                        run(
                          () =>
                            createPlanFromProposal(data.client.id, selectedProposal).then(() =>
                              advanceStep(data.client.id, "content_plan", { plan_source: "proposal" })
                            ),
                          "Plan seeded from the proposal — it's on the calendar now."
                        )
                      }
                    >
                      {isPending ? <Loader2 className="size-4 animate-spin mr-1" /> : <ChevronRight className="size-4 mr-1" />}
                      Seed plan from proposal
                    </Button>
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" disabled={isPending} onClick={() => delegate(current.id)}>
                    <MessageSquareText className="size-4 mr-1" /> Ask Malory to plan it
                  </Button>
                  {data.plans.length > 0 && (
                    <Button size="sm" disabled={isPending} onClick={() => completeStep(current.id)}>
                      {isPending ? <Loader2 className="size-4 animate-spin mr-1" /> : <Check className="size-4 mr-1" />}
                      Plan is ready — continue
                    </Button>
                  )}
                </div>
              </div>
            )}

            {current.id === "publish_targets" && (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <p className="text-xs font-medium">WordPress / websites</p>
                  {data.platforms.blog.length > 0 ? (
                    data.platforms.blog.map((b) => (
                      <div key={b.id} className="flex items-center justify-between text-sm border-b pb-2">
                        <span>{b.site_name}</span>
                        <span className="text-xs text-muted-foreground">{b.site_url}</span>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">No WordPress site connected yet — blog posts can still be saved as drafts.</p>
                  )}
                  <p className="text-xs font-medium pt-2">Social accounts</p>
                  {data.platforms.social.length > 0 ? (
                    data.platforms.social.map((s) => (
                      <div key={s.id} className="flex items-center justify-between text-sm border-b pb-2">
                        <span className="capitalize">{s.platform}</span>
                        <span className="text-xs text-muted-foreground">{s.account_name ?? ""}</span>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">No social accounts connected yet.</p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" disabled={isPending} onClick={() => completeStep(current.id)}>
                    {isPending ? <Loader2 className="size-4 animate-spin mr-1" /> : <Check className="size-4 mr-1" />}
                    Targets confirmed
                  </Button>
                  <Button size="sm" variant="outline" disabled={isPending} onClick={() => delegate(current.id)}>
                    <MessageSquareText className="size-4 mr-1" /> Ask Malory
                  </Button>
                </div>
              </div>
            )}

            {current.id === "go_live" && (
              <div className="space-y-4">
                <ul className="space-y-1.5 text-sm">
                  {[
                    "Client workspace ready",
                    connectionCount >= 3 ? "Tools connected" : "Tools connected (some missing — can add later)",
                    data.brandProfiles.length > 0 ? "Brand profile set" : "Brand profile (optional — can add later)",
                    data.plans.length > 0 ? `Content plan: ${data.plans.length} plan(s) on the calendar` : "Content plan (none yet — Malory can map one)",
                    data.platforms.blog.length > 0 || data.platforms.social.length > 0
                      ? "Publish targets configured"
                      : "Publish targets (none yet — drafts still work)",
                  ].map((line) => (
                    <li key={line} className="flex items-start gap-2">
                      <Check className="size-4 text-green-600 mt-0.5 shrink-0" />
                      {line}
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    disabled={isPending}
                    onClick={() => run(() => announceGoLive(data.client.id), "The client is live — Malory announced the kickoff in the Team Room.")}
                  >
                    {isPending ? <Loader2 className="size-4 animate-spin mr-1" /> : <Check className="size-4 mr-1" />}
                    Complete onboarding & go live
                  </Button>
                  <Button size="sm" variant="outline" disabled={isPending} onClick={() => delegate(current.id)}>
                    <MessageSquareText className="size-4 mr-1" /> Ask Malory
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
