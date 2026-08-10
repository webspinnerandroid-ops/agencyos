"use server"

import { revalidatePath } from "next/cache"
import { headers } from "next/headers"
import { createServiceClient } from "@/lib/supabase/server"
import { requireClientRole } from "@/lib/auth"
import {
  notifyPostApproved,
  notifyPostNeedsRevision,
} from "@/lib/notifications"

// ------------------------------------------------------------------
// approvePost
// Marks a post as "approved" (client → ready for agency scheduling).
// ------------------------------------------------------------------
export async function approvePost(postId: string): Promise<void> {
  const clientId = await requireClientRole()
  const headersList = await headers()
  const tenantId = headersList.get("x-tenant-id")!

  const supabase = await createServiceClient()

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

  if (existing.client_id !== clientId) {
    throw new Error("Access denied: post does not belong to your client")
  }

  // Update status
  const { error: updateError } = await supabase
    .from("posts")
    .update({ status: "approved" })
    .eq("id", postId)
    .eq("tenant_id", tenantId)

  if (updateError) {
    throw new Error(`Failed to approve post: ${updateError.message}`)
  }

  // Notify agency that the client approved a post
  // (In production, look up the agency contact email from tenant settings)
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
    // Notification failure should not block the action
    console.warn("Failed to send approval notification")
  }

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

  // Get the current user from the headers injected by proxy
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

  if (existing.client_id !== clientId) {
    throw new Error("Access denied: post does not belong to your client")
  }

  // Update status
  const { error: updateError } = await supabase
    .from("posts")
    .update({ status: "revision_requested" })
    .eq("id", postId)
    .eq("tenant_id", tenantId)

  if (updateError) {
    throw new Error(`Failed to request revision: ${updateError.message}`)
  }

  // Create a comment with the revision feedback
  const { error: commentError } = await supabase.from("comments").insert({
    post_id: postId,
    user_id: userId ?? null,
    body: comment.trim(),
  })

  if (commentError) {
    console.warn("Failed to create revision comment:", commentError.message)
  }

  // Notify agency that client requested a revision
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
    // Notification failure should not block the action
    console.warn("Failed to send revision notification")
  }

  revalidatePath("/portal/dashboard")
}
