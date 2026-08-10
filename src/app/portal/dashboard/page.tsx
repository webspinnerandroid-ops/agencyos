import { headers } from "next/headers"
import { createServiceClient } from "@/lib/supabase/server"
import ClientDashboard from "./client-dashboard"
import { requireClientRole } from "@/lib/auth"

// ------------------------------------------------------------------
// Types (mirrors CalendarPost for compatibility)
// ------------------------------------------------------------------
export interface ClientPost {
  id: string
  content: string | null
  media_urls: string[]
  scheduled_at: string | null
  status: string
  client_id: string | null
  platform: string | null
}

// ------------------------------------------------------------------
// Server Component — fetches initial data, delegates to client shell
// ------------------------------------------------------------------
export default async function ClientPortalDashboardPage() {
  const clientId = await requireClientRole()
  const headersList = await headers()
  const tenantId = headersList.get("x-tenant-id")!

  const supabase = await createServiceClient()

  // Fetch client info (name, website)
  const { data: client } = await supabase
    .from("clients")
    .select("name, website")
    .eq("id", clientId)
    .eq("tenant_id", tenantId)
    .single()

  // Fetch all posts for this client
  const { data: posts } = await supabase
    .from("posts")
    .select(
      `
      id,
      content,
      media_urls,
      scheduled_at,
      status,
      client_id,
      post_platforms (
        social_accounts (
          platform
        )
      )
    `
    )
    .eq("tenant_id", tenantId)
    .eq("client_id", clientId)
    .order("scheduled_at", { ascending: true })

  // Flatten platform info
  const formattedPosts: ClientPost[] = (posts ?? []).map((post: any) => {
    const platforms = post.post_platforms
      ?.map((pp: any) => pp.social_accounts?.platform)
      .filter(Boolean)

    return {
      id: post.id,
      content: post.content,
      media_urls: post.media_urls ?? [],
      scheduled_at: post.scheduled_at,
      status: post.status,
      client_id: post.client_id,
      platform: platforms?.join(", ") ?? null,
    }
  })

  return (
    <ClientDashboard
      posts={formattedPosts}
      clientName={client?.name ?? "Your Content"}
      clientId={clientId}
    />
  )
}