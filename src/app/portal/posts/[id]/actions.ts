"use server"

import { revalidatePath } from "next/cache"
import { headers } from "next/headers"
import { createServiceClient } from "@/lib/supabase/server"
import { requireClientRole } from "@/lib/auth"
import {
  notifyPostApproved,
  notifyPostNeedsRevision,
  notifyCommentAdded,
} from "@/lib/notifications"

// ------------------------------------------------------------------
// approvePost
// Marks a post as "approved" (shared with dashboard actions).
// ------------------------------------------------------------------
export async function approvePost(postId: string): Promise<void> {
  const clientId = await requireClientRole()
  const headersList = await headers()
  const tenantId = headersList.get("x-tenant-id")!

  const supabase = await createServiceClient()

  const { data: existing, error: fetchError } = await supabase
    .from("posts")
    .select("id, content, client_id")
    .eq("id", postId)
    .eq("tenant_id", tenantId)
    .eq("client_id", clientId)
    .single()

  if (fetchError || !existing) {
    throw new Error("Post not found or access denied")
  }

  if (existing.client_id !== clientId) {
    throw new Error("Access denied: post does not belong to your client")
  }

  const { error: updateError } = await supabase
    .from("posts")
    .update({ status: "approved" })
    .eq("id", postId)
    .eq("tenant_id", tenantId)

  if (updateError) {
    throw new Error(`Failed to approve post: ${updateError.message}`)
  }

  try {
    await notifyPostApproved(
      { email: "agency@example.com", name: "Agency" },
      {
        postId,
        postContent: existing.content ?? "",
        clientName: "Client",
        postUrl: `/dashboard/calendar?post=${postId}`,
      }
    )
  } catch {
    console.warn("Failed to send approval notification")
  }

  revalidatePath(`/portal/posts/${postId}`)
  revalidatePath("/portal/dashboard")
}

// ------------------------------------------------------------------
// requestRevision
// Marks a post as "revision_requested" and creates a comment.
// ------------------------------------------------------------------
export async function requestRevision(
  postId: string,
  comment: string
): Promise<void> {
  const clientId = await requireClientRole()
  const headersList = await headers()
  const tenantId = headersList.get("x-tenant-id")!

  if (!comment || !comment.trim()) {
    throw new Error("Revision comment is required")
  }

  const supabase = await createServiceClient()

  // Get user ID from proxy-injected headers
  const userId = headersList.get("x-user-id") ?? null

  const { data: existing, error: fetchError } = await supabase
    .from("posts")
    .select("id, content, client_id")
    .eq("id", postId)
    .eq("tenant_id", tenantId)
    .eq("client_id", clientId)
    .single()

  if (fetchError || !existing) {
    throw new Error("Post not found or access denied")
  }

  if (existing.client_id !== clientId) {
    throw new Error("Access denied: post does not belong to your client")
  }

  const { error: updateError } = await supabase
    .from("posts")
    .update({ status: "revision_requested" })
    .eq("id", postId)
    .eq("tenant_id", tenantId)

  if (updateError) {
    throw new Error(`Failed to request revision: ${updateError.message}`)
  }

  const { error: commentError } = await supabase.from("comments").insert({
    post_id: postId,
    user_id: userId ?? null,
    body: comment.trim(),
  })

  if (commentError) {
    console.warn("Failed to create revision comment:", commentError.message)
  }

  try {
    await notifyPostNeedsRevision(
      { email: "agency@example.com", name: "Agency" },
      {
        postId,
        postContent: existing.content ?? "",
        clientName: "Client",
        postUrl: `/dashboard/calendar?post=${postId}`,
      },
      comment.trim()
    )
  } catch {
    console.warn("Failed to send revision notification")
  }

  revalidatePath(`/portal/posts/${postId}`)
  revalidatePath("/portal/dashboard")
}

// ------------------------------------------------------------------
// addComment
// Creates a new comment on a post (client-side discussion).
// ------------------------------------------------------------------
export async function addComment(
  postId: string,
  body: string
): Promise<void> {
  const clientId = await requireClientRole()
  const headersList = await headers()
  const tenantId = headersList.get("x-tenant-id")!

  if (!body || !body.trim()) {
    throw new Error("Comment body is required")
  }

  const supabase = await createServiceClient()

  // Get user ID from proxy-injected headers
  const userId = headersList.get("x-user-id") ?? null

  // Verify the post belongs to this client + tenant
  const { data: existing, error: fetchError } = await supabase
    .from("posts")
    .select("id, content, client_id")
    .eq("id", postId)
    .eq("tenant_id", tenantId)
    .eq("client_id", clientId)
    .single()

  if (fetchError || !existing) {
    throw new Error("Post not found or access denied")
  }

  const { error: insertError } = await supabase.from("comments").insert({
    post_id: postId,
    user_id: userId ?? null,
    body: body.trim(),
  })

  if (insertError) {
    throw new Error(`Failed to add comment: ${insertError.message}`)
  }

  // Notify agency about the new comment
  try {
    await notifyCommentAdded(
      { email: "agency@example.com", name: "Agency" },
      {
        postId,
        postContent: existing.content ?? "",
        clientName: "Client",
        postUrl: `/dashboard/calendar?post=${postId}`,
      },
      body.trim(),
      "Client"
    )
  } catch {
    console.warn("Failed to send comment notification")
  }

  revalidatePath(`/portal/posts/${postId}`)
}
