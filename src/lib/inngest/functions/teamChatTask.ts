import { inngest } from "@/lib/inngest/client";
import {
  processTeamTask,
  type TeamTaskPayload,
} from "@/lib/ai/team-task";

/**
 * AI Team — employee task (background).
 *
 * When a chat message is sent, the API route enqueues an `ai-team/employee-task`
 * event instead of holding the HTTP request open for minutes. This function
 * runs the heavy pipeline (Malory dispatch → handoff → employee work → reply)
 * in the worker, inserting messages as it goes. The chat UI polls the thread
 * and shows each stage live — and because each message is its own run, the
 * user can be chatting with one agent while another is still working.
 *
 * `retries: 0` — processTeamTask already catches failures and posts an error
 * reply with the taskId so the client's pending task always resolves; a retry
 * would just duplicate messages.
 */
export const teamChatTask = inngest.createFunction(
  {
    id: "ai-team-employee-task",
    name: "AI Team Employee Task",
    retries: 0,
    triggers: [
      {
        event: "ai-team/employee-task",
      },
    ],
  },
  async ({ event }) => {
    const payload = event.data as TeamTaskPayload;

    if (!payload?.chatId || !payload?.tenantId || !payload?.userMessage) {
      console.error("[teamChatTask] Malformed payload:", payload);
      return { status: "rejected", reason: "malformed payload" };
    }

    console.log(
      `[teamChatTask] Processing task ${payload.taskId} for chat ${payload.chatId} (tenant ${payload.tenantId})`
    );

    await processTeamTask(payload);

    return { status: "completed", taskId: payload.taskId };
  }
);
