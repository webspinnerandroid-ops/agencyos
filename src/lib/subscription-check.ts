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

/**
 * Decide whether a low-balance alert should fire for a provider. Alerts when
 * credit is at/below the threshold, but at most once per 24h (tracked in the
 * row's low_balance_alerted_at). Returns false when credit is above the
 * threshold so callers can clear the alerted timestamp.
 */
export function shouldAlertLowBalance(
  credit: number,
  threshold: number,
  alertedAt: string | null,
  now = Date.now()
): boolean {
  if (credit > threshold) return false;
  if (!alertedAt) return true;
  const hours = (now - new Date(alertedAt).getTime()) / 3_600_000;
  return hours >= 24;
}

/**
 * Email the super admin about a low provider balance via Resend (direct
 * send — the shared sendEmail helper is a log-only placeholder). Falls back
 * to a console log when RESEND_API_KEY isn't configured so the check never
 * fails on delivery.
 */
export async function sendLowBalanceAlert(params: {
  provider: string;
  credit: number | null;
  threshold: number;
  recipientEmail: string | null;
}): Promise<{ sent: boolean; detail: string }> {
  const { provider, credit, threshold, recipientEmail } = params;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || !recipientEmail) {
    console.log(
      `[low-balance] ${provider} at ${credit ?? "?"} (threshold ${threshold}) — no alert sent (missing RESEND_API_KEY or admin email)`
    );
    return { sent: false, detail: "logged only — no recipient or RESEND_API_KEY" };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL ?? "Agency OS <alerts@updates.blissmedialab.com>",
        to: [recipientEmail],
        subject: `⚠ Low balance: ${provider} is at ${credit ?? "unknown"}`,
        html: `<p>Your <strong>${provider}</strong> balance is running low:</p>
          <p style="font-size:20px;font-weight:600;">${credit ?? "?"} (alert threshold: ${threshold})</p>
          <p>Top up at the provider portal before generation fails, or raise the threshold in <strong>APIs &amp; Subscriptions</strong>.</p>`,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const body = (await res.text().catch(() => "")).slice(0, 150);
      console.error(`[low-balance] Resend failed (${res.status}): ${body}`);
      return { sent: false, detail: `Resend HTTP ${res.status}` };
    }
    return { sent: true, detail: `emailed ${recipientEmail}` };
  } catch (err) {
    console.error("[low-balance] send failed:", (err as Error).message);
    return { sent: false, detail: (err as Error).message };
  }
}

/** Env key that holds the API key for each auto-check type. */
export const ENV_KEY_FOR_CHECK: Record<string, string> = {
  stripe: "STRIPE_SECRET_KEY",
  resend: "RESEND_API_KEY",
  fal: "FAL_AI_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_API_KEY",
};

export interface CheckRowResult {
  ok: boolean;
  credit?: number | null;
  detail?: string;
  error?: string;
  alertSent?: boolean;
}

/**
 * Run one registry row's auto-check, persist the result, and fire a
 * low-balance alert when credit is at/below the row's threshold (at most once
 * per 24h; cleared when credit recovers). Used by both the admin route (manual
 * "Check balances") and the scheduled job (proactive daily alerts).
 */
export async function checkAndAlertRow(
  supabase: any,
  row: any,
  recipientEmail: string | null
): Promise<CheckRowResult> {
  const checkType = String(row.auto_check ?? "");
  if (checkType === "manual") {
    return { ok: false, error: "This provider has no auto-check (track manually)" };
  }
  const envKey = ENV_KEY_FOR_CHECK[checkType];
  const apiKey = envKey ? process.env[envKey] : undefined;
  if (!apiKey) return { ok: false, error: `${envKey} is not configured on the server` };

  try {
    const result = await autoCheck(checkType, apiKey);
    await supabase
      .from("subscription_registry")
      .update({
        credit_remaining: result.creditRemaining,
        last_checked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);

    let alertSent = false;
    const threshold = Number(row.low_balance_threshold ?? NaN);
    if (Number.isFinite(threshold) && result.creditRemaining != null) {
      const alertedAt = row.low_balance_alerted_at ?? null;
      if (result.creditRemaining > threshold) {
        if (alertedAt) {
          await supabase
            .from("subscription_registry")
            .update({ low_balance_alerted_at: null })
            .eq("id", row.id);
        }
      } else if (shouldAlertLowBalance(result.creditRemaining, threshold, alertedAt)) {
        await sendLowBalanceAlert({
          provider: row.provider,
          credit: result.creditRemaining,
          threshold,
          recipientEmail,
        });
        await supabase
          .from("subscription_registry")
          .update({ low_balance_alerted_at: new Date().toISOString() })
          .eq("id", row.id);
        alertSent = true;
      }
    }

    return { ok: true, credit: result.creditRemaining, detail: result.detail, alertSent };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "check failed" };
  }
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
