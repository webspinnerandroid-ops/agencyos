// src/lib/price-drift.ts
// Pure, side-effect-free logic shared by the nightly price-drift check
// (scripts/check-price-drift.ts) and its unit tests. Keeping normalization
// and classification here means the check can't silently change behavior
// without the test suite noticing.

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

export type WebhookService = "discord" | "slack";

/** Discord and Slack incoming webhooks both accept a POSTed JSON payload. */
export function detectWebhookService(url: string): WebhookService {
  return url.includes("discord.com/api/webhooks") ? "discord" : "slack";
}

/**
 * Build the JSON body for a Slack or Discord incoming webhook from a drift
 * summary. Discord uses embeds; Slack (and generic hooks) use attachments.
 * `runId` is the GitHub Actions run id when running in CI.
 */
export function buildWebhookPayload(
  service: WebhookService,
  summary: DriftSummary,
  runId: string | undefined
): Record<string, unknown> {
  const heading = summary.ok
    ? `✅ Price drift check: ALL SYNCED (${summary.total}/${summary.total})`
    : `❌ Price drift check: ${summary.failures} item(s) out of sync`;
  const description = summary.ok
    ? `Checked ${summary.total} plan/hub display prices against live Stripe monthly prices. No drift detected — the landing page matches what checkout charges.`
    : `Checked ${summary.total} plan/hub display prices against live Stripe monthly prices. One or more prices have drifted — fix the price in Stripe, then update the stored display copy.`;

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
