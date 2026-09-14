import { inngest } from "@/lib/inngest/client";
import { createServiceClient } from "@/lib/supabase/server";
import {
  classifyEmail,
  persistClassification,
  ClassificationRule,
} from "@/lib/agency/email-classifier";

// ============================================================================
// classifySyncedEmails — Phase 6 wiring.
//
// Runs after every inbox sync: pulls the accounts' recent messages from the
// Gmail/Outlook APIs through the existing Archer layer's account registry,
// classifies rules-first with a confidence-gated cheap-LLM fallback, and
// writes email_classifications + activity ledger rows. Read-only: nothing in
// this function can send mail (see classify-safety.test.ts).
// ============================================================================

/** Cap per run — a first backfill can be large; the cron picks up the rest. */
const MAX_PER_RUN = 40;

export const classifySyncedEmails = inngest.createFunction(
  {
    id: "agency-classify-emails",
    name: "Agency Ops — Classify Synced Emails",
    retries: 2,
    triggers: [
      { event: "inngest/function.finished", expression: "event.data.function_id == 'sync-inboxes'" },
      { cron: "*/20 * * * *" }, // safety net so nothing sits unclassified
    ],
  },
  async ({ step }) => {
    const classified = await step.run("classify-recent", async () => {
      const supabase = await createServiceClient();
      const { data: accounts } = await supabase
        .from("email_accounts")
        .select("id, tenant_id, platform, email_address")
        .limit(2); // MVP scope: 2 accounts
      if (!accounts || accounts.length === 0) return { processed: 0 };

      let processed = 0;

      // Worker iterates every tenant's accounts (same pattern as
      // syncInboxes — reviewed exception in audit-tenant-scope.cjs IGNORE).
      // Client matching data is fetched PER TENANT so classifications for
      // one tenant can never be influenced by another tenant's clients.
      for (const account of accounts) {
        if (processed >= MAX_PER_RUN) break;
        const tenantId = account.tenant_id as string;

        const { data: clientsForTenant } = await supabase
          .from("clients")
          .select("id, name, website, email")
          .eq("tenant_id", tenantId);
        const clients = (clientsForTenant ?? []).map((c) => ({
          clientId: c.id as string,
          name: c.name as string,
          website: (c.website as string | null) ?? null,
          email: (c.email as string | null) ?? null,
        }));
        const rules = await loadRules(supabase, tenantId);

        const messages = await fetchRecentMessages(step, account.id as string);
        for (const message of messages) {
          if (processed >= MAX_PER_RUN) break;
          const result = await classifyEmail(
            message,
            rules,
            clients,
            completeLlm(step, tenantId)
          );
          await persistClassification(tenantId, result, message);
          processed += 1;
        }
      }
      return { processed };
    });
    return classified;
  }
);

// ---------------------------------------------------------------------------
// Rules loading — from email_rule_feedback corrections (method: rule:<name>)
// ---------------------------------------------------------------------------

interface StoredRule {
  name: string;
  from_domain?: string;
  from_email?: string;
  subject_contains?: string[];
  category: string;
  client_id: string | null;
}

async function loadRules(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  tenantId: string
): Promise<ClassificationRule[]> {
  const { data: feedback } = await supabase
    .from("email_rule_feedback")
    .select("note, corrected_category, corrected_client_id")
    .eq("tenant_id", tenantId)
    .limit(50);
  if (!feedback) return [];
  // Feedback rows carry an optional JSON rule in `note` (seeded by triage);
  // rows without one are skipped. This keeps the MVP's rule store in one table.
  const rules: StoredRule[] = [];
  for (const row of feedback) {
    if (!row.note || !row.note.trim().startsWith("{")) continue;
    try {
      const parsed = JSON.parse(row.note) as StoredRule;
      if (parsed.name && parsed.category) rules.push(parsed);
    } catch {
      // not a rule — ignore
    }
  }
  return rules.map<ClassificationRule>((r) => ({
    name: r.name,
    when: {
      ...(r.from_domain ? { from_domain: r.from_domain } : {}),
      ...(r.from_email ? { from_email: r.from_email } : {}),
      ...(r.subject_contains ? { subject_contains: r.subject_contains } : {}),
    },
    then: { category: r.category as ClassificationRule["then"]["category"] },
  }));
}

// ---------------------------------------------------------------------------
// Message fetching — reuses the Archer account registry via a minimal
// metadata-only fetch (no new OAuth flows, no providers).
// ---------------------------------------------------------------------------

async function fetchRecentMessages(
  step: { run: (name: string, fn: () => Promise<unknown>) => Promise<unknown> },
  accountId: string
): Promise<
  { accountId: string; messageId: string; threadId: string | null; from: string; fromName: string | null; subject: string; bodyText: string; receivedAt: string }[]
> {
  return (await step.run(`fetch-${accountId}`, async () => {
    const supabase = await createServiceClient();
    const { data: account } = await supabase
      .from("email_accounts")
      .select("id, tenant_id, platform, encrypted_token")
      .eq("id", accountId)
      .maybeSingle();
    if (!account) return [];
    const { decrypt } = await import("@/lib/encryption");
    const tokenData = JSON.parse(decrypt(account.encrypted_token as string) ?? "{}");
    const accessToken =
      tokenData?.access_token ?? tokenData?.accessToken ?? null;
    if (!accessToken) return [];

    if (account.platform === "gmail") {
      const res = await fetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=10",
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (!res.ok) return [];
      const list = (await res.json()) as { messages?: { id: string; threadId: string }[] };
      const out: {
        accountId: string;
        messageId: string;
        threadId: string | null;
        from: string;
        fromName: string | null;
        subject: string;
        bodyText: string;
        receivedAt: string;
      }[] = [];
      for (const m of (list.messages ?? []).slice(0, 10)) {
        const detail = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=Subject,From,Date`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (!detail.ok) continue;
        const d = (await detail.json()) as {
          id: string;
          threadId: string;
          snippet?: string;
          payload?: { headers?: { name: string; value: string }[] };
        };
        const headers = d.payload?.headers ?? [];
        const from = headers.find((h) => h.name === "From")?.value ?? "";
        const subject = headers.find((h) => h.name === "Subject")?.value ?? "(No subject)";
        out.push({
          accountId,
          messageId: d.id,
          threadId: d.threadId ?? null,
          from: from.replace(/^[^<]*<([^>]+)>.*$/, "$1").trim() || from,
          fromName: from.includes("<") ? from.replace(/<[^>]+>/, "").trim() : null,
          subject,
          bodyText: d.snippet ?? "",
          receivedAt: new Date().toISOString(),
        });
      }
      return out;
    }

    if (account.platform === "outlook") {
      const res = await fetch(
        "https://graph.microsoft.com/v1.0/me/messages?$top=10&$select=id,subject,from,bodyPreview,receivedDateTime,conversationId",
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (!res.ok) return [];
      const list = (await res.json()) as {
        value?: {
          id: string;
          subject: string | null;
          bodyPreview: string | null;
          receivedDateTime: string;
          conversationId: string | null;
          from?: { emailAddress?: { address?: string; name?: string } };
        }[];
      };
      return (list.value ?? []).map((m) => ({
        accountId,
        messageId: m.id,
        threadId: m.conversationId ?? null,
        from: m.from?.emailAddress?.address ?? "",
        fromName: m.from?.emailAddress?.name ?? null,
        subject: m.subject ?? "(No subject)",
        bodyText: m.bodyPreview ?? "",
        receivedAt: m.receivedDateTime,
      }));
    }

    return [];
  })) as {
    accountId: string;
    messageId: string;
    threadId: string | null;
    from: string;
    fromName: string | null;
    subject: string;
    bodyText: string;
    receivedAt: string;
  }[];
}

// ---------------------------------------------------------------------------
// LLM fallback completion — routes through the tenant's model config
// (task_model_mappings task='email_generation' → fallback chain), keeping
// cost caps and provider keys in one place.
// ---------------------------------------------------------------------------

function completeLlm(
  step: { run: (name: string, fn: () => Promise<unknown>) => Promise<unknown> },
  tenantId: string
): (system: string, user: string) => Promise<string> {
  return (system, user) =>
    step.run(`llm-${Math.random().toString(36).slice(2, 8)}`, async () => {
      const { getModelForTask } = await import("@/lib/ai/orchestrator");
      const resolution = await getModelForTask(tenantId, "email_generation");
      if (!resolution.apiKey) throw new Error("no LLM key configured for email classification");
      const res = await fetch(`${resolution.providerBaseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${resolution.apiKey}`,
        },
        body: JSON.stringify({
          model: resolution.model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          temperature: 0,
          max_tokens: 300,
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`LLM call failed: ${res.status}`);
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      return json.choices?.[0]?.message?.content ?? "";
    }) as Promise<string>;
}
