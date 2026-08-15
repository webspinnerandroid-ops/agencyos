// src/lib/price-drift.ts
// Pure, side-effect-free logic shared by the nightly price-drift check
// (scripts/check-price-drift.ts) and its unit tests. Keeping normalization,
// classification, and message building here means the check can't silently
// change behavior without the test suite noticing.

export type DriftStatus =
  | "SYNCED"
  | "DRIFT"
  | "DRIFT (stored unparseable)"
  | "NO STRIPE PRICE"
  | "NO STORED PRICE";

/**
 * Normalize a stored display price ("$1,299.50", "$ 29", "29") to a number
 * of dollars. Returns null when the value can't be parsed, so the caller can
 * distinguish "missing/unparseable copy" from a real number.
 */
export function normalizeStoredPrice(value: string): number | null {
  const n = parseFloat(String(value).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Format a Stripe unit_amount (cents) as a whole or 2-decimal dollar string. */
export function fmt(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? String(dollars) : dollars.toFixed(2);
}

/**
 * Classify the relationship between a stored display price (dollars, already
 * normalized) and Stripe's live monthly price (cents). Mirrors the drift
 * check used by the page builder: anything other than SYNCED is a failure.
 */
export function classifyDrift(
  stored: number | null,
  liveCents: number | null
): DriftStatus {
  if (liveCents == null) {
    return stored == null ? "NO STORED PRICE" : "NO STRIPE PRICE";
  }
  if (stored == null) return "DRIFT (stored unparseable)";
  return Math.abs(stored - liveCents / 100) > 0.001 ? "DRIFT" : "SYNCED";
}

export type DriftEntry = {
  kind: "plan" | "hub";
  id: string;
  status: DriftStatus;
  storedStr: string;
  liveStr: string;
};

export type DriftSummary = {
  total: number;
  failures: number;
  ok: boolean;
  entries: DriftEntry[];
};

/** One-line headline, e.g. "❌ Price drift check: 2 item(s) out of sync". */
export function buildHeading(summary: DriftSummary): string {
  return summary.ok
    ? `✅ Price drift check: ALL SYNCED (${summary.total}/${summary.total})`
    : `❌ Price drift check: ${summary.failures} item(s) out of sync`;
}

/**
 * Plain-text body: how many items were checked, one line per entry, and a
 * short next step. Shared by ntfy notifications and the SMTP email.
 */
export function buildSummaryText(summary: DriftSummary): string {
  const lines = summary.entries.map(
    (e) =>
      `- ${e.kind} ${e.id.padEnd(12)} ${e.status.padEnd(24)} stored=${e.storedStr.padEnd(10)} live=${e.liveStr}`
  );
  const guidance = summary.ok
    ? "No drift detected — the landing page matches what checkout charges."
    : "Action: fix the price in Stripe, then update the stored display copy.";
  return [
    `Checked ${summary.total} plan/hub display prices against live Stripe monthly prices.`,
    "",
    ...lines,
    "",
    guidance,
  ].join("\n");
}

export type WebhookService = "discord" | "slack" | "ntfy";

/**
 * Discord, Slack, and ntfy (or a self-hosted ntfy instance) all accept a
 * POSTed JSON payload. Detection is by URL shape; anything unrecognized
 * falls back to Slack's attachment format, which most generic hooks accept.
 */
export function detectWebhookService(url: string): WebhookService {
  if (url.includes("discord.com/api/webhooks")) return "discord";
  try {
    const host = new URL(url).hostname;
    if (host === "ntfy.sh" || host.endsWith(".ntfy.sh") || host.includes("ntfy"))
      return "ntfy";
  } catch {
    // fall through to slack
  }
  return "slack";
}

/**
 * Build the JSON body for a Slack, Discord, or ntfy push from a drift
 * summary. Discord uses embeds; Slack (and generic hooks) use attachments;
 * ntfy uses {topic, title, message, tags, priority} and pushes straight to
 * subscribers' phones with no account. `runId` is the GitHub Actions run id
 * when running in CI; `ntfyTopic` is the topic from the webhook URL path.
 */
export function buildWebhookPayload(
  service: WebhookService,
  summary: DriftSummary,
  runId: string | undefined,
  ntfyTopic?: string
): Record<string, unknown> {
  const heading = buildHeading(summary);
  const description = summary.ok
    ? `Checked ${summary.total} plan/hub display prices against live Stripe monthly prices. No drift detected — the landing page matches what checkout charges.`
    : `Checked ${summary.total} plan/hub display prices against live Stripe monthly prices. One or more prices have drifted — fix the price in Stripe, then update the stored display copy.`;

  if (service === "ntfy") {
    if (!ntfyTopic) throw new Error("ntfy webhook URL must include a topic");
    return {
      topic: ntfyTopic,
      title: heading,
      message: buildSummaryText(summary),
      tags: summary.ok ? ["white_check_mark"] : ["rotating_light"],
      priority: summary.ok ? 3 : 5,
      click: runId
        ? "https://github.com/webspinnerandroid-ops/agencyos/actions"
        : undefined,
    };
  }

  if (service === "discord") {
    return {
      username: "Price Drift Check",
      embeds: [
        {
          title: heading,
          color: summary.ok ? 0x2ecc71 : 0xe74c3c,
          description,
          fields: summary.entries.map((e) => ({
            name: `${e.kind} ${e.id}`,
            value: `${e.status}\nstored: ${e.storedStr}\nlive: ${e.liveStr}`,
            inline: true,
          })),
          footer: runId
            ? { text: `Agency OS · workflow run ${runId}` }
            : undefined,
          timestamp: new Date().toISOString(),
        },
      ],
    };
  }

  return {
    text: heading,
    attachments: [
      {
        color: summary.ok ? "good" : "danger",
        title: "Agency OS · Nightly Price Drift Check",
        text: description,
        fields: summary.entries.map((e) => ({
          title: `${e.kind} ${e.id}`,
          value: `${e.status} — stored ${e.storedStr}, live ${e.liveStr}`,
          short: true,
        })),
        footer: runId ? `workflow run ${runId}` : undefined,
        ts: Math.floor(Date.now() / 1000),
      },
    ],
  };
}

/** Subject + plain-text body for the SMTP email option. */
export function buildEmailContent(
  summary: DriftSummary,
  runId: string | undefined
): { subject: string; text: string } {
  const text = [
    buildSummaryText(summary),
    "",
    `Workflow run: ${runId ?? "local run"}`,
    "Repo: https://github.com/webspinnerandroid-ops/agencyos",
  ].join("\n");
  return { subject: buildHeading(summary), text };
}
