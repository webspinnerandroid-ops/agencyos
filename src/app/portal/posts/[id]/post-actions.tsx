"use client"

import { useCallback, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { approvePost, requestRevision } from "./actions"

// ------------------------------------------------------------------
// Props
// ------------------------------------------------------------------
interface PostActionsProps {
  postId: string
  currentStatus: string
}

// ------------------------------------------------------------------
// Component
// ------------------------------------------------------------------
export default function PostActions({ postId, currentStatus }: PostActionsProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [showRevisionDialog, setShowRevisionDialog] = useState(false)
  const [revisionComment, setRevisionComment] = useState("")
  const [error, setError] = useState<string | null>(null)

  // ---- Approve handler ----
  const handleApprove = useCallback(() => {
    startTransition(async () => {
      setError(null)
      try {
        await approvePost(postId)
        router.refresh()
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to approve post"
        )
      }
    })
  }, [postId, router])

  // ---- Request revision handler ----
  const handleRequestRevision = useCallback(() => {
    if (!revisionComment.trim()) {
      setError("Please provide a reason for the revision request.")
      return
    }
    startTransition(async () => {
      setError(null)
      try {
        await requestRevision(postId, revisionComment.trim())
        setShowRevisionDialog(false)
        setRevisionComment("")
        router.refresh()
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to request revision"
        )
      }
    })
  }, [postId, revisionComment, router])

  // Only show actions for pending_approval status
  if (currentStatus !== "pending_approval" && currentStatus !== "approved") {
    return (
      <p className="text-sm text-muted-foreground text-center py-4">
        {currentStatus === "revision_requested" &&
          "You've requested a revision for this post. The agency will update it soon."}
        {currentStatus === "scheduled" &&
          "This post has been approved and scheduled for publishing."}
        {currentStatus === "published" &&
          "This post has been published."}
        {currentStatus === "draft" &&
          "This post is still a draft."}
      </p>
    )
  }

  return (
    <>
      <section className="flex items-center gap-3">
        {currentStatus === "pending_approval" && (
          <Button
            size="lg"
            style={{ backgroundColor: "var(--client-primary)" }}
            onClick={handleApprove}
            disabled={isPending}
          >
            {isPending ? "Processing…" : "Approve Post"}
          </Button>
        )}
        {(currentStatus === "pending_approval" ||
          currentStatus === "approved") && (
          <Button
            size="lg"
            variant="outline"
            style={{
              borderColor: "var(--client-primary)",
              color: "var(--client-primary)",
            }}
            onClick={() => {
              setShowRevisionDialog(true)
              setRevisionComment("")
              setError(null)
            }}
            disabled={isPending}
          >
            Request Revision
          </Button>
        )}
        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}
      </section>

      {/* ---- Revision Dialog ---- */}
      <Dialog open={showRevisionDialog} onOpenChange={setShowRevisionDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Request Revision</DialogTitle>
            <DialogDescription>
              Describe what changes you'd like the agency to make to this
              post.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {error && (
              <div className="bg-destructive/10 text-destructive text-sm rounded-md px-3 py-2">
                {error}
              </div>
            )}
            <textarea
              className="w-full rounded-md border px-3 py-2 text-sm resize-y min-h-[120px] focus:outline-none focus:ring-2 focus:ring-[var(--client-primary)]"
              placeholder="E.g. Please adjust the tone to be more casual, or add a call-to-action at the end…"
              value={revisionComment}
              onChange={(e) => setRevisionComment(e.target.value)}
              autoFocus
            />
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                setShowRevisionDialog(false)
                setRevisionComment("")
                setError(null)
              }}
            >
              Cancel
            </Button>
            <Button
              style={{ backgroundColor: "var(--client-primary)" }}
              onClick={handleRequestRevision}
              disabled={isPending || !revisionComment.trim()}
            >
              {isPending ? "Sending…" : "Send Revision Request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}