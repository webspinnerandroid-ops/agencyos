/**
 * Lifecycle step definitions — pure module (no server imports) so it can be
 * unit-tested and shared by the wizard UI, the lifecycle engine and Malory's
 * chat pipeline without pulling Next.js runtime into tests.
 */

export interface LifecycleStepDef {
  id: string;
  label: string;
  shortLabel: string;
  description: string;
}

export const LIFECYCLE_STEPS: LifecycleStepDef[] = [
  {
    id: "client_workspace",
    label: "Client & Workspace",
    shortLabel: "Client",
    description:
      "Confirm the client's details and give them a dedicated workspace so every post, asset and chat stays scoped to them.",
  },
  {
    id: "connections",
    label: "Connect Tools",
    shortLabel: "Tools",
    description:
      "Connect Google (GA4, Search Console, Drive) so audits, rankings and asset sync have real data to work with.",
  },
  {
    id: "brand_profile",
    label: "Brand Profile",
    shortLabel: "Brand",
    description:
      "Set voice, tone, persona and word targets — Cheryl and the content team write inside this voice.",
  },
  {
    id: "content_plan",
    label: "Content Plan",
    shortLabel: "Plan",
    description:
      "Map the campaign: seed it from an approved proposal or ask Malory to draft a dated plan on the calendar.",
  },
  {
    id: "publish_targets",
    label: "Publish Targets",
    shortLabel: "Publish",
    description:
      "Choose where content goes live: WordPress site, social accounts, or the site blog.",
  },
  {
    id: "go_live",
    label: "Go Live",
    shortLabel: "Live",
    description:
      "Approve the plan, deploy the campaign calendar, and announce the kickoff to the team.",
  },
];

export const STEP_IDS = LIFECYCLE_STEPS.map((s) => s.id) as string[];

export function stepIndexFor(stepId: string): number {
  const idx = STEP_IDS.indexOf(stepId);
  return idx === -1 ? 0 : idx;
}

/** The next step index after a given step (clamped to the last step). */
export function nextStepAfter(stepIndex: number): number {
  return Math.min(stepIndex + 1, LIFECYCLE_STEPS.length - 1);
}
