import { headers } from "next/headers"
import { createServiceClient } from "@/lib/supabase/server"
import { requireClientRole } from "@/lib/auth"
import { format, parseISO } from "date-fns"
import PostComments from "./post-comments"
import PostActions from "./post-actions"
import PostContent from "@/components/BlogContent"

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------
interface PostDetail {
  id: string
  content: string | null
  media_urls: string[]
  scheduled_at: string | null
  status: string
  client_id: string | null
  platform: string | null
}

interface Comment {
  id: string
  post_id: string
  user_id: string | null
  body: string | null
  created_at: string
  author_name: string | null
}

// ------------------------------------------------------------------
// Server Component — fetches post + comments, delegates realtime to client
// ------------------------------------------------------------------
export default async function PostDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id: postId } = await params
  const clientId = await requireClientRole()
  const headersList = await headers()
  const tenantId = headersList.get("x-tenant-id")!

  const supabase = await createServiceClient()

  // Fetch post
  const { data: post, error: postError } = await supabase
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
    .eq("id", postId)
    .eq("tenant_id", tenantId)
    .eq("client_id", clientId)
    .single()

  if (postError || !post) {
    return (
      <div className="py-24 text-center">
        <h1 className="text-2xl font-bold">Post Not Found</h1>
        <p className="text-muted-foreground mt-2">
          The post you're looking for doesn't exist or you don't have access to it.
        </p>
        <a
          href="/portal/dashboard"
          className="inline-block mt-4 text-[var(--client-primary)] hover:underline"
        >
          ← Back to Dashboard
        </a>
      </div>
    )
  }

  // Flatten platform info
  const platforms = (post as any).post_platforms
    ?.map((pp: any) => pp.social_accounts?.platform)
    .filter(Boolean)
  const platform = platforms?.join(", ") ?? null

  const postDetail: PostDetail = {
    id: post.id,
    content: post.content,
    media_urls: post.media_urls ?? [],
    scheduled_at: post.scheduled_at,
    status: post.status,
    client_id: post.client_id,
    platform,
  }

  // Fetch existing comments
  const { data: comments } = await supabase
    .from("comments")
    .select(
      `
      id,
      post_id,
      user_id,
      body,
      created_at,
      user_roles!user_id (
        client_id
      )
    `
    )
    .eq("post_id", postId)
    .order("created_at", { ascending: true })

  // Determine author display name: if user_id matches client's user role → "You", else "Agency"
  // We need to figure out which comments are from the client and which from the agency
  // For simplicity, if user_id is not null (i.e., the comment was created by someone),
  // we can fetch the user role. But since we already know the client_id, we can
  // cross-reference with user_roles.client_id.
  const formattedComments: Comment[] = (comments ?? []).map((c: any) => {
    const isClientComment =
      c.user_roles && Array.isArray(c.user_roles)
        ? c.user_roles.some((ur: any) => ur.client_id === clientId)
        : false

    return {
      id: c.id,
      post_id: c.post_id,
      user_id: c.user_id,
      body: c.body,
      created_at: c.created_at,
      author_name: isClientComment ? "You" : "Agency",
    }
  })

  // Status badge config
  const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
    draft: { label: "Draft", className: "bg-gray-100 text-gray-700" },
    pending_approval: {
      label: "Pending Approval",
      className: "bg-yellow-100 text-yellow-700",
    },
    approved: {
      label: "Approved",
      className: "bg-green-100 text-green-700",
    },
    revision_requested: {
      label: "Revision Requested",
      className: "bg-orange-100 text-orange-700",
    },
    scheduled: {
      label: "Scheduled",
      className: "bg-blue-100 text-blue-700",
    },
    published: {
      label: "Published",
      className: "bg-emerald-100 text-emerald-700",
    },
    failed: { label: "Failed", className: "bg-red-100 text-red-700" },
  }

  const statusConfig = STATUS_CONFIG[postDetail.status] ?? STATUS_CONFIG.draft

  return (
    <div className="space-y-8 max-w-3xl mx-auto">
      {/* Back link */}
      <a
        href="/portal/dashboard"
        className="text-sm text-muted-foreground hover:text-[var(--client-primary)] transition-colors inline-flex items-center gap-1"
      >
        ← Back to Dashboard
      </a>

      {/* Post Header */}
      <div>
        <div className="flex items-center gap-3 mb-2">
          <span
            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusConfig.className}`}
          >
            {statusConfig.label}
          </span>
          {postDetail.platform && (
            <span className="text-xs text-muted-foreground uppercase tracking-wide">
              {postDetail.platform}
            </span>
          )}
        </div>
        <h1 className="text-2xl font-bold tracking-tight">
          {postDetail.scheduled_at
            ? format(parseISO(postDetail.scheduled_at), "MMMM d, yyyy")
            : "Unscheduled Post"}
        </h1>
      </div>

      {/* Post Content */}
      <section className="border rounded-lg p-6 bg-card">
        <h2 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wider">
          Content
        </h2>
        <div className="text-sm leading-relaxed">
          <PostContent content={postDetail.content} />
        </div>
      </section>

      {/* Media */}
      {postDetail.media_urls.length > 0 && (
        <section className="border rounded-lg p-6 bg-card">
          <h2 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wider">
            Media
          </h2>
          <div className="flex gap-3 flex-wrap">
            {postDetail.media_urls.map((url, i) => (
              <img
                key={i}
                src={url}
                alt={`Media ${i + 1}`}
                className="size-24 object-cover rounded-lg border"
              />
            ))}
          </div>
        </section>
      )}

      {/* Actions (Approve / Request Revision) */}
      <PostActions
        postId={postDetail.id}
        currentStatus={postDetail.status}
      />

      {/* Comments Section with Realtime */}
      <section className="border rounded-lg p-6 bg-card">
        <h2 className="text-sm font-semibold mb-4 text-muted-foreground uppercase tracking-wider">
          Discussion
        </h2>
        <PostComments
          postId={postDetail.id}
          initialComments={formattedComments}
          clientId={clientId}
        />
      </section>
    </div>
  )
}