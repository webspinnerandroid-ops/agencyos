// campaign-from-proposal.ts
//
// Turn a sold SEO proposal into a dated campaign plan WITHOUT an LLM call.
// The proposal already contains the blueprint — monthly focus areas, content
// pieces with titles + target keywords + priorities, technical and link
// building tasks. Materializing it directly means the calendar plan matches
// exactly what was sold (no drift, no re-invention), costs nothing, and is
// instant. Malory can then be asked to polish dates/titles if the owner
// wants a human-touch pass.
import { createServiceClient } from "@/lib/supabase/server";
import {
  createCampaignPlan,
  type CampaignPlan,
} from "@/lib/campaign-plans";
import { generateDates, getFrequency } from "@/lib/seo/deployCampaign";

interface ProposalContentPiece {
  type?: string;
  title: string;
  targetKeyword?: string;
  description?: string;
  priority?: "high" | "medium" | "low" | string;
}

interface ProposalMonth {
  month?: number;
  focusArea?: string;
  contentPieces?: ProposalContentPiece[];
  technicalTasks?: string[];
  linkBuildingTasks?: string[];
}

interface ProposalCampaignJson {
  tierName?: string;
  tierPrice?: number;
  executiveSummary?: string;
  targetKeywords?: unknown[];
  contentCalendar?: ProposalMonth[];
  deliverables?: string[];
  [key: string]: unknown;
}

/** Which employee executes each content type (Cheryl writes, Pam runs social). */
const TYPE_OWNERS: Record<string, string> = {
  blog_post: "penny",
  case_study: "penny",
  whitepaper: "penny",
  social_post: "sonny",
  video: "sonny",
  infographic: "sonny",
};

/**
 * Website-build milestones appended to the plan when the owner opts to
 * include a website in the campaign. Owned by Ray (dev) and dated across
 * the first month so the build runs alongside the content sprint.
 */
const WEBSITE_MILESTONES = [
  {
    topic: "Website structure & sitemap — pages, sections and content hierarchy",
    week: 0,
  },
  {
    topic: "Build core site pages with copy, images and global stylesheet",
    week: 1,
  },
  {
    topic: "Launch the site — connect blog publishing and go live",
    week: 3,
  },
];

const TYPE_PLATFORM: Record<string, string | null> = {
  blog_post: null,
  case_study: null,
  whitepaper: null,
  social_post: "instagram",
  video: "instagram",
  infographic: "instagram",
};

/**
 * Seed a campaign plan from an approved SEO proposal tier.
 *
 * - Uses the tier's first month (the launch sprint) as the plan scope: its
 *   content pieces become plan items with the sold titles + keywords.
 * - Dates come from the tier's posting frequency (generateDates → next
 *   Monday, weekdays, tier cadence) — no LLM guesswork about "next week".
 * - Owners are assigned by content type (penny for blogs, sonny for socials).
 *
 * The plan lands on the Content Calendar as proposed items, ready to be
 * approved one-by-one into draft posts.
 */
export async function createCampaignFromProposal(
  tenantId: string,
  campaignId: string,
  workspaceId: string | null,
  includeWebsite = false
): Promise<CampaignPlan> {
  const supabase = await createServiceClient();
  const { data: campaign, error } = await supabase
    .from("seo_campaigns")
    .select("*")
    .eq("id", campaignId)
    .eq("tenant_id", tenantId)
    .single();
  if (error || !campaign) {
    throw new Error(`Proposal campaign not found: ${error?.message ?? ""}`);
  }

  const json = (campaign.campaign_json ?? {}) as ProposalCampaignJson;
  const months = Array.isArray(json.contentCalendar)
    ? json.contentCalendar
    : [];
  const launch = months[0];
  const pieces = launch?.contentPieces ?? [];
  if (pieces.length === 0) {
    throw new Error(
      "This tier has no content pieces scheduled yet — generate a proposal first."
    );
  }

  const tierName =
    json.tierName ??
    (typeof campaign.tier_name === "string" ? campaign.tier_name : "Tier");
  const frequency = getFrequency(tierName);
  const dates = generateDates(pieces.length, frequency);

  // The tier's link-building tasks become suggested external-link targets
  // (URLs only — the proposal stores them as text, so pass through as-is).
  const externalLinks = (launch?.linkBuildingTasks ?? [])
    .filter((t): t is string => typeof t === "string" && t.length > 0)
    .slice(0, 5);

  const items = pieces
    .map((piece, i) => {
      const type = (piece.type ?? "blog_post").toLowerCase();
      return {
        kind: (type === "social_post" || type === "video" || type === "infographic"
          ? "social"
          : "blog") as "blog" | "social",
        topic: piece.title,
        dueDate: dates[i]?.slice(0, 10) ?? "",
        platform: TYPE_PLATFORM[type] ?? null,
        owner: TYPE_OWNERS[type] ?? "penny",
        // Approve-time transparency: the proposed keywords come from the
        // sold proposal's content piece so approving is informed, not blind.
        keywords: piece.targetKeyword ? [piece.targetKeyword] : null,
        externalLinks: externalLinks.length > 0 ? externalLinks : null,
      };
    })
    .filter((i) => i.dueDate);

  const focusArea = launch?.focusArea
    ? ` — ${launch.focusArea}`
    : "";

  // Website-build milestones (owner: Ray / dev) when the owner opted in —
  // dated across the first month so the build lands on the calendar
  // alongside the content sprint.
  const websiteItems = includeWebsite
    ? WEBSITE_MILESTONES.map((m) => {
        const due = dates[Math.min(m.week, dates.length - 1)]?.slice(0, 10);
        if (!due) return null;
        return {
          kind: "website" as const,
          topic: m.topic,
          dueDate: due,
          platform: null,
          owner: "dev",
          keywords: null,
          externalLinks: null,
        };
      }).filter((i): i is NonNullable<typeof i> => i !== null)
    : [];

  const allItems = [...items, ...websiteItems].sort((a, b) =>
    a.dueDate.localeCompare(b.dueDate)
  );

  const summary = [
    json.executiveSummary ?? "",
    `Seeded from the ${tierName} proposal: ${items.length} content pieces across the first month${focusArea}, scheduled at the tier's cadence. Owners assigned by content type. Approve items to turn them into drafts.`,
    includeWebsite
      ? "Website build included: structure, page build and launch milestones are on the calendar, owned by Ray — approving one opens the Web Builder to work on it."
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  return createCampaignPlan(tenantId, {
    title: `${tierName}: Content Campaign${focusArea}`,
    summary,
    workspaceId,
    createdBy: "proposal",
    items: allItems,
  });
}
