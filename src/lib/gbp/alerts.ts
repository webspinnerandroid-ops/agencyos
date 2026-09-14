// ============================================================================
// Reputation alert webhooks — fires a Slack/Discord/generic-hook message the
// moment a new 1★ review lands on any connected Google listing.
//
// A tenant can register any number of webhook URLs in the gbp_alert_webhooks
// table (via Settings → Google Business Profile). Each row carries the URL
// and the lowest star rating that should trigger it (min_stars: 1 = only
// 1★ disasters, 3 = 3★ and worse).
//
// Payload shape adapts to the target: Discord wants embeds, Slack wants
// attachments, and anything else gets Slack's format (the de-facto generic).
// Detection is by URL shape — same approach as lib/price-drift.ts.
//
// Failures are logged, never thrown: an unreachable webhook must never break
// the review sync or lose a snapshot.
// ============================================================================

export interface ReviewAlertInput {
  tenantId: string;
  businessName: string;
  reviewerName: string | null;
  /** Google starRating word: ONE..FIVE. */
  starRating: string;
  comment: string | null;
  createTime: string | null;
  /** Relative path of the dashboard page that handles replies. */
  dashboardPath?: string;
}

interface AlertHook {
  webhook_url: string;
  min_stars: number | null;
}

export function starsFromWord(word: string): number {
  return ({ ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 }[word] ?? 0);
}

export type AlertService = "discord" | "slack";

/** Discord webhooks get embeds; everything else gets Slack's format. */
export function detectAlertService(url: string): AlertService {
  return url.includes("discord.com/api/webhooks") ? "discord" : "slack";
}

function excerpt(text: string | null | undefined, max = 300): string {
  if (!text) return "";
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Build the JSON body for one alert, shaped for the target service. */
export function buildAlertPayload(
  url: string,
  input: ReviewAlertInput,
  siteUrl: string
): Record<string, unknown> {
  const stars = starsFromWord(input.starRating);
  const who = input.reviewerName ?? "A Google user";
  const link = `${siteUrl}${input.dashboardPath ?? "/dashboard/reputation"}`;
  const service = detectAlertService(url);

  if (service === "discord") {
    return {
      username: "Reputation Alerts",
      embeds: [
        {
          title: `🚨 1★ Google review — ${input.businessName}`,
          url: link,
          color: 0xe74c3c,
          fields: [
            { name: "Reviewer", value: who, inline: true },
            { name: "Rating", value: `${stars}★`, inline: true },
            ...(input.comment
              ? [{ name: "Comment", value: excerpt(input.comment) || "—" }]
              : []),
          ],
          footer: { text: "Lana has a draft reply waiting on the Reputation dashboard" },
          timestamp: input.createTime ?? new Date().toISOString(),
        },
      ],
    };
  }

  return {
    text: `🚨 1★ Google review — ${input.businessName}`,
    attachments: [
      {
        color: "danger",
        title: `${stars}★ from ${who}`,
        title_link: link,
        text: excerpt(input.comment) || "(no comment left)",
        fields: [
          { title: "Business", value: input.businessName, short: true },
          { title: "Reply at", value: link, short: false },
        ],
        footer: "Lana has a draft reply waiting on the Reputation dashboard",
        ts: Math.floor(Date.now() / 1000),
      },
    ],
  };
}

/** Load every webhook row for a tenant. Caller scopes by tenantId. */
export async function listAlertWebhooks(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  tenantId: string
): Promise<AlertHook[]> {
  const { data, error } = await supabase
    .from("gbp_alert_webhooks")
    .select("webhook_url, min_stars")
    .eq("tenant_id", tenantId);
  if (error) {
    console.warn("[gbpAlert] load webhooks failed:", error.message);
    return [];
  }
  return (data ?? []) as AlertHook[];
}

/**
 * Fan a new-review alert out to every configured webhook whose threshold
 * matches. Never throws — a broken webhook must not break the sync.
 */
export async function dispatchReviewAlert(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  input: ReviewAlertInput
): Promise<{ sent: number; failed: number }> {
  const stars = starsFromWord(input.starRating);
  if (stars <= 0) return { sent: 0, failed: 0 };

  const hooks = await listAlertWebhooks(supabase, input.tenantId);
  if (hooks.length === 0) return { sent: 0, failed: 0 };

  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
  const matching = hooks.filter(
    (h) => !h.min_stars || stars <= h.min_stars
  );
  let sent = 0;
  let failed = 0;
  await Promise.all(
    matching.map(async (hook) => {
      try {
        const res = await fetch(hook.webhook_url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildAlertPayload(hook.webhook_url, input, siteUrl)),
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) {
          sent += 1;
        } else {
          failed += 1;
          console.warn(
            `[gbpAlert] webhook HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 150)}`
          );
        }
      } catch (err) {
        failed += 1;
        console.warn(
          "[gbpAlert] webhook failed:",
          err instanceof Error ? err.message : err
        );
      }
    })
  );
  return { sent, failed };
}
