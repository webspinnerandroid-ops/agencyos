/**
 * SEO Campaign Auto-Deployment
 *
 * Reads an approved campaign JSON, creates post entries with scheduled dates
 * based on the content calendar using a generateDates function that respects
 * tier frequency, and sends a notification to the agency.
 */

import { createServiceClient } from "@/lib/supabase/server";
import { notifyPostReadyForApproval } from "@/lib/notifications";
import { slugify } from "@/lib/cms";
import { announceCampaignDeployed } from "@/lib/client-lifecycle";

// ============================================================================
// Types
// ============================================================================

export interface ContentPiece {
  type:
    | "blog_post"
    | "landing_page"
    | "case_study"
    | "whitepaper"
    | "video"
    | "infographic";
  title: string;
  targetKeyword: string;
  description: string;
  estimatedWordCount: number;
  priority: "high" | "medium" | "low";
}

export interface CalendarMonth {
  month: number;
  focusArea: string;
  contentPieces: ContentPiece[];
  technicalTasks: string[];
  linkBuildingTasks: string[];
  expectedOutcomes: string;
}

export interface CampaignJson {
  tierName: string;
  tierPrice: number;
  executiveSummary: string;
  targetKeywords: unknown[];
  contentCalendar: CalendarMonth[];
  deliverables?: string[];
  [key: string]: unknown;
}

export interface DeployResult {
  campaignId: string;
  postsCreated: number;
  posts: { id: string; title: string; scheduledAt: string }[];
  errors: string[];
}

// ============================================================================
// Frequency mapping
// ============================================================================

/**
 * Maps tier names to posting frequency schedules.
 * - Bronze: 2 long-form posts/month = ~0.5/week
 * - Silver: 4 posts/month = ~1/week
 * - Gold: 8 posts/month = ~2/week
 * - Custom: depends, default to Gold level
 */
const TIER_FREQUENCIES: Record<string, number> = {
  bronze: 1,
  silver: 1,
  gold: 2,
  custom: 2,
  starter: 1, // backward compat
  growth: 2, // backward compat
  dominance: 3, // backward compat
  premium: 5, // backward compat
  enterprise: 3, // backward compat
  default: 1,
};

/** Maps tier name strings to integer levels for the posts.tier_level column */
const TIER_LEVELS: Record<string, number> = {
  bronze: 1,
  silver: 2,
  gold: 3,
  custom: 4,
  starter: 1, // backward compat
  growth: 2, // backward compat
  dominance: 3, // backward compat
  premium: 4, // backward compat
  enterprise: 3, // backward compat
  default: 1,
};

function getTierLevel(tierName: string): number {
  const key = tierName.toLowerCase();
  // Partial match: "Bronze – Essentials" → "bronze", "Gold – Market Leader" → "gold"
  for (const tierKey of Object.keys(TIER_LEVELS)) {
    if (key.includes(tierKey)) return TIER_LEVELS[tierKey];
  }
  return TIER_LEVELS.default;
}

export function getFrequency(tierName: string): number {
  const key = tierName.toLowerCase();
  // Partial match: "Bronze – Essentials" → "bronze", "Silver – Growth" → "silver"
  for (const tierKey of Object.keys(TIER_FREQUENCIES)) {
    if (key.includes(tierKey)) return TIER_FREQUENCIES[tierKey];
  }
  return TIER_FREQUENCIES.default;
}

// ============================================================================
// generateDates
// ============================================================================

/**
 * Generates an array of scheduled publication dates based on a tier's
 * posting frequency. Distributes posts evenly across the campaign months,
 * avoiding weekends by default.
 *
 * @param totalPosts - Total number of content pieces to schedule
 * @param frequencyPerWeek - How many posts per week the tier allows
 * @param startDate - Starting date (defaults to next Monday)
 * @returns Array of ISO date strings
 */
export function generateDates(
  totalPosts: number,
  frequencyPerWeek: number,
  startDate?: Date
): string[] {
  const dates: string[] = [];
  const start = startDate ?? getNextMonday();
  const current = new Date(start);

  let scheduled = 0;
  let weekPosts = 0;

  while (scheduled < totalPosts) {
    // Skip weekends
    const day = current.getDay();
    if (day !== 0 && day !== 6) {
      // Weekday
      dates.push(current.toISOString());
      scheduled++;
      weekPosts++;

      // If we hit the weekly limit, advance to next week
      if (weekPosts >= frequencyPerWeek) {
        weekPosts = 0;
        // Move to next Monday
        const daysUntilMonday = ((8 - current.getDay()) % 7) || 7;
        current.setDate(current.getDate() + daysUntilMonday);
        // Reset to start of day
        current.setHours(9, 0, 0, 0);
        continue;
      }
    }

    // Advance by one day
    current.setDate(current.getDate() + 1);
    // Set to 9 AM
    current.setHours(9, 0, 0, 0);
  }

  return dates;
}

function getNextMonday(): Date {
  const now = new Date();
  const day = now.getDay();
  // If today is Monday (1), use today; otherwise find next Monday
  const daysUntilMonday = day === 1 ? 0 : ((8 - day) % 7) || 7;
  const monday = new Date(now);
  monday.setDate(monday.getDate() + daysUntilMonday);
  monday.setHours(9, 0, 0, 0);
  return monday;
}

// ============================================================================
// deployCampaign
// ============================================================================

/**
 * Reads an approved campaign, generates post entries from the content calendar,
 * and stores them in the `posts` table with scheduled dates.
 *
 * Process:
 * 1. Fetch the campaign from `seo_campaigns` table
 * 2. Verify it's in "approved" status
 * 3. Extract all content pieces from the content calendar
 * 4. Generate scheduled dates based on tier frequency
 * 5. Create post entries in the `posts` table
 * 6. Send notification to the agency
 * 7. Update campaign status to "active"
 *
 * @param campaignId - The ID of the approved campaign
 * @param tenantId - The tenant ID
 * @returns DeployResult with summary of created posts
 */
export async function deployCampaign(
  campaignId: string,
  tenantId: string
): Promise<DeployResult> {
  const supabase = await createServiceClient();
  const errors: string[] = [];

  // 1. Fetch the campaign
  const { data: campaign, error: fetchError } = await supabase
    .from("seo_campaigns")
    .select("*")
    .eq("id", campaignId)
    .eq("tenant_id", tenantId)
    .single();

  if (fetchError || !campaign) {
    throw new Error(
      `Campaign not found: ${fetchError?.message ?? "unknown error"}`
    );
  }

  // 2. Verify status
  if (campaign.status !== "approved") {
    throw new Error(
      `Campaign must be in "approved" status to deploy. Current status: ${campaign.status}`
    );
  }

  const campaignJson = campaign.campaign_json as CampaignJson;
  const clientId = campaign.client_id as string;

  // Resolve (or create) the client's workspace so deployed posts are not
  // orphaned with workspace_id = NULL. Previously posts deployed with no
  // workspace never surfaced in workspace-scoped views (Recent Content,
  // calendar, AI team chat) and campaign work lived outside the client's
  // workspace entirely.
  let workspaceId: string | null = null;
  try {
    if (clientId) {
      const { data: client } = await supabase
        .from("clients")
        .select("workspace_id, name")
        .eq("id", clientId)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      workspaceId = client?.workspace_id ?? null;
      if (!workspaceId && client) {
        // No workspace yet — create a dedicated one for this client.
        const base = slugify(client.name || "Client").slice(0, 40);
        const { data: ws, error: wsError } = await supabase
          .from("workspaces")
          .insert({
            tenant_id: tenantId,
            name: client.name || "Client Workspace",
            slug: `${base}-${crypto.randomUUID().slice(0, 8)}`,
            is_default: false,
          })
          .select("id")
          .single();
        if (!wsError && ws) {
          workspaceId = ws.id;
          await supabase
            .from("clients")
            .update({ workspace_id: ws.id })
            .eq("id", clientId)
            .eq("tenant_id", tenantId);
        }
      }
    }
  } catch (wsError) {
    errors.push(`Could not resolve workspace: ${(wsError as Error).message}`);
  }

  // 3. Extract content pieces from all months
  const contentPieces: { piece: ContentPiece; month: number }[] = [];

  for (const month of campaignJson.contentCalendar ?? []) {
    for (const piece of month.contentPieces ?? []) {
      contentPieces.push({ piece, month: month.month });
    }
  }

  if (contentPieces.length === 0) {
    throw new Error("No content pieces found in the campaign calendar");
  }

  // 4. Generate dates
  const frequency = getFrequency(campaignJson.tierName);
  const dates = generateDates(contentPieces.length, frequency);

  // Compute tier level as integer from name string
  const tierLevelValue = getTierLevel(campaignJson.tierName);

  // 5. Create post entries
  const createdPosts: { id: string; title: string; scheduledAt: string }[] = [];

  for (let i = 0; i < contentPieces.length; i++) {
    const { piece, month } = contentPieces[i];
    const scheduledAt = dates[i] ?? new Date().toISOString();

    const postContent = {
      type: "seo_content",
      contentPiece: {
        contentType: piece.type,
        title: piece.title,
        targetKeyword: piece.targetKeyword,
        description: piece.description,
        estimatedWordCount: piece.estimatedWordCount,
        priority: piece.priority,
      },
      campaignId: campaignId,
      campaignMonth: month,
      campaignTier: campaignJson.tierName,
    };

    const { data: post, error: insertError } = await supabase
      .from("posts")
      .insert({
        tenant_id: tenantId,
        client_id: clientId,
        workspace_id: workspaceId,
        content: postContent,
        status: "draft",
        scheduled_at: scheduledAt,
        ai_generated: false,
        tier_level: tierLevelValue,
      })
      .select("id")
      .single();

    if (insertError) {
      errors.push(
        `Failed to create post "${piece.title}": ${insertError.message}`
      );
    } else if (post) {
      createdPosts.push({
        id: post.id,
        title: piece.title,
        scheduledAt,
      });
    }
  }

  // 6. Update campaign status to "active"
  const { error: updateError } = await supabase
    .from("seo_campaigns")
    .update({
      status: "active",
      deployed_at: new Date().toISOString(),
    })
    .eq("id", campaignId);

  if (updateError) {
    errors.push(`Failed to update campaign status: ${updateError.message}`);
  }

  // 7. Send notification to agency
  // Try to get the user who created the campaign for notification. NOTE: the
  // old code queried a nonexistent `users` table (PGRST202 crash); auth users
  // live in Supabase Auth, so resolve via the admin API instead.
  if (campaign.created_by) {
    try {
      const { data: authUser } = await supabase.auth.admin.getUserById(
        campaign.created_by as string
      );
      const email = authUser?.user?.email ?? null;
      if (email) {
        await notifyPostReadyForApproval(
          { email, name: "Agency User" },
          {
            postId: campaignId,
            postContent: `Campaign "${campaignJson.tierName}" has been deployed with ${createdPosts.length} posts.`,
            clientName: "Client",
            postUrl: `/dashboard/seo/campaigns`,
          }
        );
      }
    } catch (notifyError) {
      console.warn(
        "[deployCampaign] Could not send notification:",
        notifyError
      );
    }
  }

  // 8. Announce the kickoff to the Team Room (Malory) so the AI team picks up
  // the deployed campaign. Best-effort — a missing chat must never fail the
  // deployment.
  try {
    await announceCampaignDeployed(
      tenantId,
      workspaceId,
      clientId,
      campaignJson.tierName,
      createdPosts.length
    );
  } catch (announceError) {
    console.warn("[deployCampaign] Team Room announcement skipped:", announceError);
  }

  return {
    campaignId,
    postsCreated: createdPosts.length,
    posts: createdPosts,
    errors,
  };
}

// ============================================================================
// approveAndDeploy
// ============================================================================

/**
 * Convenience function that:
 * 1. Approves a campaign by updating its status
 * 2. Deploys the campaign content
 *
 * @param campaignId - The ID of the campaign to approve and deploy
 * @param tenantId - The tenant ID
 * @returns DeployResult
 */
export async function approveAndDeploy(
  campaignId: string,
  tenantId: string
): Promise<DeployResult> {
  const supabase = await createServiceClient();

  // Update campaign status to approved
  const { error: approveError } = await supabase
    .from("seo_campaigns")
    .update({ status: "approved", approved_at: new Date().toISOString() })
    .eq("id", campaignId)
    .eq("tenant_id", tenantId);

  if (approveError) {
    throw new Error(
      `Failed to approve campaign: ${approveError.message}`
    );
  }

  // Deploy
  return deployCampaign(campaignId, tenantId);
}