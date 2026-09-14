// ============================================================================
// Publish history — shared shapes for the per-post publish history shown on
// the dashboard and Posts list. publishing_logs rows are scoped at the
// application layer (no tenant_id column), so callers first fetch the
// tenant/workspace-scoped posts, then join the logs by post_id.
// ============================================================================

export interface PublishHistoryEntry {
  postId: string;
  platform: string | null;
  siteName: string | null;
  targetUrl: string | null;
  success: boolean;
  errorMessage: string | null;
  attemptAt: string | null;
}

/** Group raw publishing_logs rows by post_id, keeping only the given posts. */
export function mapPublishLogsToHistory(
  rows: Array<Record<string, unknown>> | null | undefined,
  postIds: string[]
): Record<string, PublishHistoryEntry[]> {
  const allowed = new Set(postIds);
  const out: Record<string, PublishHistoryEntry[]> = {};
  for (const r of rows ?? []) {
    const postId = r?.post_id;
    if (typeof postId !== "string" || !allowed.has(postId)) continue;
    (out[postId] ??= []).push({
      postId,
      platform: typeof r.platform === "string" ? r.platform : null,
      siteName: typeof r.site_name === "string" ? r.site_name : null,
      targetUrl: typeof r.target_url === "string" ? r.target_url : null,
      success: r.success === true,
      errorMessage:
        typeof r.error_message === "string" ? r.error_message : null,
      attemptAt: typeof r.attempt_at === "string" ? r.attempt_at : null,
    });
  }
  return out;
}