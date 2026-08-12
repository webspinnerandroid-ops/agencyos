/**
 * Live balance/usage checks for the subscription registry.
 *
 * Only providers with a reliable, keyed API are supported:
 *  - stripe → GET /v1/balance (available funds, in dollars)
 *  - resend → GET /usage (emails used vs plan limit this cycle)
 * Everything else in the registry is tracked manually from the portal.
 */

export interface AutoCheckResult {
  creditRemaining: number | null;
  detail?: string;
}

async function getJson(url: string, apiKey: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const body = (await res.text().catch(() => "")).slice(0, 150);
    throw new Error(`HTTP ${res.status}: ${body}`);
  }
  return res.json();
}

/** Stripe: available account balance in dollars (cents → $). */
export async function checkStripeBalance(apiKey: string): Promise<AutoCheckResult> {
  const data = (await getJson("https://api.stripe.com/v1/balance", apiKey)) as {
    available?: { amount?: number; currency?: string }[];
  };
  const available = (data.available ?? []).reduce(
    (sum, b) => sum + (b.amount ?? 0),
    0
  );
  return {
    creditRemaining: Math.round((available / 100) * 100) / 100,
    detail: "Available balance (Stripe)",
  };
}

/** Resend: emails remaining in the current billing cycle. */
export async function checkResendUsage(apiKey: string): Promise<AutoCheckResult> {
  const data = (await getJson("https://api.resend.com/usage", apiKey)) as {
    usage?: number;
    limit?: number;
    resetAt?: string;
  };
  const usage = Number(data.usage ?? 0);
  const limit = Number(data.limit ?? 0);
  return {
    creditRemaining: limit > 0 ? Math.max(0, limit - usage) : null,
    detail:
      limit > 0
        ? `Used ${usage.toLocaleString()} of ${limit.toLocaleString()} emails this cycle`
        : `Used ${usage.toLocaleString()} emails (unlimited plan)`,
  };
}

/** Map a registry auto_check type to a live check. Throws on unknown types. */
export async function autoCheck(
  autoCheckType: string,
  apiKey: string
): Promise<AutoCheckResult> {
  switch (autoCheckType) {
    case "stripe":
      return checkStripeBalance(apiKey);
    case "resend":
      return checkResendUsage(apiKey);
    default:
      throw new Error(`No auto-check implemented for "${autoCheckType}"`);
  }
}
