import { NextRequest, NextResponse } from "next/server";
import { getTenantId, requireRole } from "@/lib/auth";
import { getCurrentWorkspaceId } from "@/lib/workspace";
import { rateLimitRequest } from "@/lib/rate-limit";
import {
  startBatch,
  stopBatch,
  getBatchStatus,
} from "@/lib/content-map-batch";

export const maxDuration = 60;

/**
 * POST /api/content-map/batch
 *
 * Controls the SERVER-SIDE batch runner for the content map:
 *   { action: "start" }            — claim all planned items and generate
 *                                    them one at a time in the background.
 *                                    Returns immediately; the loop survives
 *                                    navigation away from the page.
 *   { action: "stop" }             — stop after the in-flight item finishes;
 *                                    remaining items return to planned.
 *   { action: "status" }           — { running, done, total } for polling.
 *
 * The starting user's cookie header is captured so each generation runs
 * through the normal /api/generate-content auth/billing path.
 */
export async function POST(request: NextRequest) {
  try {
    const rl = rateLimitRequest(request, "content-map-batch", 30);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: `Rate limit exceeded. Try again in ${rl.retryAfterSeconds}s.` },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
      );
    }

    const tenantId = await getTenantId();
    await requireRole("agency_editor");
    const workspaceId = await getCurrentWorkspaceId().catch(() => null);

    const body = (await request.json().catch(() => ({}))) as {
      action?: string;
      clientId?: string | null;
      brandVoice?: string | null;
      imagePref?: number | "auto";
      /** Per-row generation: only these item ids (must be planned). */
      itemIds?: string[];
    };

    if (body.action === "start") {
      const result = await startBatch({
        tenantId,
        workspaceId,
        // Auth for the loopback self-calls: the starting user's cookies.
        cookie: request.headers.get("cookie") ?? "",
        // The origin this server answers on (loopback in dev; the deployment
        // URL in prod — same process either way).
        origin: request.nextUrl.origin,
        clientId: body.clientId ?? null,
        brandVoice: body.brandVoice ?? null,
        itemIds:
          Array.isArray(body.itemIds) && body.itemIds.length > 0
            ? body.itemIds.filter((id) => typeof id === "string" && id.length > 0)
            : undefined,
        imagePref:
          body.imagePref === "auto" ||
          (typeof body.imagePref === "number" && body.imagePref >= 0 && body.imagePref <= 3)
            ? body.imagePref
            : "auto",
      });
      if (!result.started) {
        return NextResponse.json(
          {
            started: false,
            reason: result.reason,
            ...(result.reason === "already_running" ? getBatchStatus(tenantId, workspaceId) : {}),
          },
          { status: result.reason === "already_running" ? 200 : 400 }
        );
      }
      return NextResponse.json({ started: true, claimed: result.claimed });
    }

    if (body.action === "stop") {
      const stopped = stopBatch(tenantId, workspaceId);
      return NextResponse.json({ stopped });
    }

    if (body.action === "status") {
      return NextResponse.json(getBatchStatus(tenantId, workspaceId));
    }

    return NextResponse.json(
      { error: "action must be one of: start, stop, status" },
      { status: 400 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** GET is a convenience alias for { action: "status" } (UI polling). */
export async function GET(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    await requireRole("agency_editor");
    const workspaceId = await getCurrentWorkspaceId().catch(() => null);
    return NextResponse.json(getBatchStatus(tenantId, workspaceId));
  } catch {
    // Polling endpoint: an expired session should not spam errors.
    return NextResponse.json({ running: false, done: 0, total: 0 });
  }
}
