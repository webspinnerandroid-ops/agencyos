import { generateStructuredOutput } from "@/lib/ai/orchestrator";
import { createServiceClient } from "@/lib/supabase/server";

export interface DiscoveredBlog {
  blog_name: string;
  blog_url: string;
  contact_email: string;
  relevance_score: number;
  authority_score: number;
  traffic_estimate: string;
  why: string;
}

/**
 * Discover real guest-post-accepting blogs for a topic and save them as
 * 'discovered' targets for the tenant/workspace. Scores are AI estimates and
 * labeled as such in the UI — never presented as real metrics.
 */
export async function discoverBlogsForTopic(
  tenantId: string,
  workspaceId: string | null,
  topic: string,
  keywords: string[] = [],
  contextNote = ""
): Promise<number> {
  const discovered = await generateStructuredOutput<{ blogs: DiscoveredBlog[] }>(
    "team_chat",
    `You are an outreach researcher for a digital agency. Find REAL blogs that
publish guest posts relevant to this niche. Only include blogs you are confident
exist (well-known publications or established niche blogs). For each, give:
- blog_name: the blog's name
- blog_url: the exact https:// homepage URL
- contact_email: the blog's guest-post/editor contact email IF widely published,
  otherwise an empty string (never invent an email)
- relevance_score: 0-100 how well this blog matches the niche
- authority_score: 0-100 an estimate of the blog's domain authority / page-rank
  strength (based on how well-known and linked-to it is)
- traffic_estimate: a rough monthly-visitor band like "50k-100k"
- why: one sentence on why they accept relevant guest posts here
Return JSON: { "blogs": [...] } with 6-10 entries. Never invent URLs.`,
    `Niche/topic: ${topic}\nFocus keywords: ${keywords.join(", ") || "(none)"}${
      contextNote ? `\nContext (from the client's campaign plan): ${contextNote}` : ""
    }\n\nReturn 6-10 real blogs accepting guest posts.`,
    tenantId,
    {
      type: "object",
      properties: {
        blogs: {
          type: "array",
          items: {
            type: "object",
            properties: {
              blog_name: { type: "string" },
              blog_url: { type: "string" },
              contact_email: { type: "string" },
              relevance_score: { type: "number" },
              authority_score: { type: "number" },
              traffic_estimate: { type: "string" },
              why: { type: "string" },
            },
            required: [
              "blog_name",
              "blog_url",
              "contact_email",
              "relevance_score",
              "authority_score",
              "traffic_estimate",
              "why",
            ],
          },
        },
      },
      required: ["blogs"],
    },
    { functionName: "discover_guest_post_blogs" }
  );

  const supabase = await createServiceClient();
  const blogs = Array.isArray(discovered.blogs) ? discovered.blogs : [];
  let inserted = 0;
  for (const blog of blogs) {
    if (!blog.blog_url || !/^https?:\/\//.test(blog.blog_url)) continue;
    const { error } = await supabase.from("outreach_targets").insert({
      tenant_id: tenantId,
      workspace_id: workspaceId,
      blog_name: blog.blog_name || null,
      blog_url: blog.blog_url,
      contact_email: blog.contact_email || null,
      relevance_score: Math.max(0, Math.min(100, Math.round(Number(blog.relevance_score) || 0))),
      authority_score: Math.max(0, Math.min(100, Math.round(Number(blog.authority_score) || 0))),
      traffic_estimate: blog.traffic_estimate || null,
      notes: blog.why || null,
      status: "discovered",
    });
    if (!error) inserted += 1;
  }
  return inserted;
}
