import { getDefaultBrandProfile } from "@/lib/brand-profile";
import { buildBrandSystemPrompt } from "@/lib/brand-profile-utils";
import { getWorkspaceKnowledgeContext } from "@/lib/knowledgebase";
import { getCurrentWorkspaceId } from "@/lib/workspace";

/**
 * Loads the tenant's current-workspace brand profile + knowledgebase context
 * so standalone generators (images, videos) are grounded in the same brand
 * and KB material the content pipeline uses.
 *
 * Returns the context string (empty when nothing is configured) and the
 * resolved workspace id so callers can tag assets with it.
 */
export async function buildWorkspacePromptContext(
  tenantId: string
): Promise<{ context: string; workspaceId: string | null }> {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return { context: "", workspaceId: null };

  let context = "";
  try {
    const brandRes = await getDefaultBrandProfile();
    if (brandRes.success && brandRes.data) {
      context += buildBrandSystemPrompt(brandRes.data);
    }
    const kbContext = await getWorkspaceKnowledgeContext(workspaceId, tenantId);
    if (kbContext) context += "\n\n" + kbContext;
  } catch (err) {
    console.warn("[workspace-context] Could not load brand/KB context:", err);
  }
  return { context, workspaceId };
}

/**
 * Appends workspace context to a user prompt. The context is instruction
 * material for the model — the user's own prompt stays first so their intent
 * keeps priority.
 */
export function augmentPromptWithContext(prompt: string, context: string): string {
  const trimmed = prompt.trim();
  if (!context) return trimmed;
  return `${trimmed}\n\n${context}`;
}
