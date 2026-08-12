/**
 * Verify the chat truncation fix end-to-end WITHOUT the browser or images:
 * runs processTeamTask directly with a long legal question for Cyril and
 * checks the reply is not cut off mid-sentence.
 *
 * Usage: npx tsx scripts/verify-chat-truncation.ts
 */
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import fs from "fs";

// Load env BEFORE importing modules that read process.env.
const env = Object.fromEntries(
  fs
    .readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")];
    })
);
for (const [k, v] of Object.entries(env)) process.env[k] = v;

const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY
);

(async () => {
  const { data: ws } = await supabase.from("workspaces").select("*").limit(1).single();
  if (!ws) throw new Error("no workspace");
  const tenantId = ws.tenant_id;

  const { data: chat } = await supabase
    .from("team_chats")
    .select("*")
    .eq("kind", "team")
    .eq("workspace_id", ws.id)
    .maybeSingle();
  if (!chat) throw new Error("no team chat");
  console.log("tenant:", tenantId, "chat:", chat.id, "workspace:", ws.id);

  const { processTeamTask } = await import("../src/lib/ai/team-task");

  const message =
    "Cyril, draft a full set of terms and conditions for a coffee shop website " +
    "covering liability for allergic reactions, gift card expiry rules, online " +
    "ordering cancellations, refund policy, privacy policy summary, and a " +
    "hold-harmless clause for property damage — please be thorough with the " +
    "actual legal language for each.";

  await processTeamTask({
    chatId: chat.id,
    tenantId,
    workspaceId: ws.id,
    userMessage: message,
    taskId: randomUUID(),
  });

  const { data } = await supabase
    .from("team_messages")
    .select("employee_key, content, created_at")
    .eq("employee_key", "linda")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  if (!data?.content) throw new Error("no Cyril reply found");
  const c = data.content;
  console.log("WORDS:", c.split(/\s+/).length);
  console.log("START:", c.slice(0, 100).replace(/\n/g, " "));
  console.log("END:", c.slice(-160).replace(/\n/g, " "));
})().catch((err) => {
  console.error("VERIFY FAILED:", err);
  process.exit(1);
});
