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
  try {
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
  } catch (err) {
    const msg = (err as Error).message;
    // A send-only key can't read /usage — surface the fix instead of a bare failure.
    if (/restricted_api_key|restricted to only send/i.test(msg)) {
      return {
        creditRemaining: null,
        detail:
          "Key is restricted to sending only — create a full-access Resend API key to auto-check usage",
      };
    }
    throw err;
  }
}

/**
 * fal.ai: available account credit (the admin API key uses a `Key ` prefix,
 * not `Bearer`). Returns the current credit balance in USD.
 */
export async function checkFalBilling(apiKey: string): Promise<AutoCheckResult> {
  const res = await fetch(
    "https://api.fal.ai/v1/account/billing?expand=credits",
    {
      headers: { Authorization: `Key ${apiKey}` },
      signal: AbortSignal.timeout(15_000),
    }
  );
  if (!res.ok) {
    const body = (await res.text().catch(() => "")).slice(0, 150);
    throw new Error(`HTTP ${res.status}: ${body}`);
  }
  const data = (await res.json()) as {
    credits?: { current_balance?: number; currency?: string };
  };
  const balance = Number(data.credits?.current_balance);
  if (Number.isFinite(balance)) {
    return {
      creditRemaining: Math.round(balance * 100) / 100,
      detail: `Available credit (fal.ai, ${data.credits?.currency ?? "USD"})`,
    };
  }
  return {
    creditRemaining: null,
    detail: "fal.ai returned billing info without a credit balance",
  };
}

/**
 * OpenAI: there is no account-balance endpoint for a plain API key (the
 * dashboard credit_grants API requires a session token). Verify the key
 * works so the row shows a real status, and point at the usage portal for
 * the number.
 */
export async function checkOpenAIKey(apiKey: string): Promise<AutoCheckResult> {
  const res = await fetch("https://api.openai.com/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const body = (await res.text().catch(() => "")).slice(0, 150);
    throw new Error(`HTTP ${res.status}: ${body}`);
  }
  return {
    creditRemaining: null,
    detail:
      "Key valid — OpenAI doesn't expose a balance via API key; see platform.openai.com/usage",
  };
}

/**
 * Google AI (Gemini/Imagen): AI Studio keys are free-tier or Cloud-billed and
 * expose no credit balance. Verify the key works, then flag manual tracking.
 */
export async function checkGoogleAIKey(apiKey: string): Promise<AutoCheckResult> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
    { signal: AbortSignal.timeout(15_000) }
  );
  if (!res.ok) {
    const body = (await res.text().catch(() => "")).slice(0, 150);
    throw new Error(`HTTP ${res.status}: ${body}`);
  }
  return {
    creditRemaining: null,
    detail:
      "Key valid — Google AI (Gemini/Imagen) doesn't expose a credit balance via API key",
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
    case "fal":
      return checkFalBilling(apiKey);
    case "openai":
      return checkOpenAIKey(apiKey);
    case "google":
      return checkGoogleAIKey(apiKey);
    default:
      throw new Error(`No auto-check implemented for "${autoCheckType}"`);
  }
}
