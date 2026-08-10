"use client"

import { useCallback, useEffect, useState, useTransition } from "react"
import { format, parseISO } from "date-fns"
import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/client"
import { addComment } from "./actions"

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------
interface Comment {
  id: string
  post_id: string
  user_id: string | null
  body: string | null
  created_at: string
  author_name: string | null
}

interface CommentPayload {
  id: string
  post_id: string
  user_id: string | null
  body: string | null
  created_at: string
}

// ------------------------------------------------------------------
// Props
// ------------------------------------------------------------------
interface PostCommentsProps {
  postId: string
  initialComments: Comment[]
  clientId: string
}

// ------------------------------------------------------------------
// Component
// ------------------------------------------------------------------
export default function PostComments({
  postId,
  initialComments,
  clientId,
}: PostCommentsProps) {
  const [comments, setComments] = useState<Comment[]>(initialComments)
  const [newComment, setNewComment] = useState("")
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  // ---- Supabase Realtime subscription ----
  useEffect(() => {
    const supabase = createClient()

    // Subscribe to INSERT events on the comments table for this post
    const channel = supabase
      .channel(`comments:${postId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "comments",
          filter: `post_id=eq.${postId}`,
        },
        (payload: { new: CommentPayload }) => {
          const newRow = payload.new

          // Mark as "Agency" unless we know it's from the client (client auth check
          // happens server-side; for realtime we use a simple heuristic:
          // user_id in the session can be checked on the client but we don't
          // have that context in realtime inserts. We'll default to "Agency"
          // and let the client user know they wrote it when they submit).
          const authorLabel = "Agency"

          setComments((prev) => {
            // Avoid duplicates (in case INSERT fires before our optimistic update)
            if (prev.some((c) => c.id === newRow.id)) return prev

            return [
              ...prev,
              {
                id: newRow.id,
                post_id: newRow.post_id,
                user_id: newRow.user_id,
                body: newRow.body,
                created_at: newRow.created_at,
                author_name: authorLabel,
              },
            ]
          })
        }
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [postId])

  // ---- Submit new comment (server action) ----
  const handleSubmit = useCallback(() => {
    if (!newComment.trim()) return

    startTransition(async () => {
      setError(null)
      try {
        await addComment(postId, newComment.trim())
        setNewComment("")
        // The comment will appear via the Realtime subscription above
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to add comment"
        )
      }
    })
  }, [newComment, postId])

  return (
    <div className="space-y-4">
      {/* Existing comments */}
      {comments.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">
          No comments yet. Use the discussion to provide feedback.
        </p>
      ) : (
        <div className="space-y-3 max-h-96 overflow-y-auto pr-2">
          {comments.map((comment) => (
            <div
              key={comment.id}
              className={
                comment.author_name === "You"
                  ? "flex flex-col items-end"
                  : "flex flex-col items-start"
              }
            >
              <div
                className={`max-w-[85%] rounded-lg px-4 py-2.5 text-sm ${
                  comment.author_name === "You"
                    ? "bg-[var(--client-primary)] text-white"
                    : "bg-muted text-foreground"
                }`}
              >
                <p className="whitespace-pre-wrap">{comment.body ?? ""}</p>
              </div>
              <div className="flex items-center gap-2 mt-1 px-1">
                <span className="text-[10px] font-medium text-muted-foreground">
                  {comment.author_name ?? "Unknown"}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {format(parseISO(comment.created_at), "MMM d, h:mm a")}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Divider */}
      {comments.length > 0 && (
        <div className="border-t pt-4" />
      )}

      {/* New comment form */}
      <div>
        {error && (
          <div className="bg-destructive/10 text-destructive text-sm rounded-md px-3 py-2 mb-3">
            {error}
          </div>
        )}

        <textarea
          className="w-full rounded-md border px-3 py-2 text-sm resize-y min-h-[80px] focus:outline-none focus:ring-2 focus:ring-[var(--client-primary)]"
          placeholder="Add a comment or feedback…"
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          disabled={isPending}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              handleSubmit()
            }
          }}
        />

        <div className="flex items-center justify-between mt-2">
          <span className="text-xs text-muted-foreground">
            Press Cmd+Enter to send
          </span>
          <Button
            size="sm"
            style={{ backgroundColor: "var(--client-primary)" }}
            disabled={isPending || !newComment.trim()}
            onClick={handleSubmit}
          >
            {isPending ? "Sending…" : "Add Comment"}
          </Button>
        </div>
      </div>
    </div>
  )
}