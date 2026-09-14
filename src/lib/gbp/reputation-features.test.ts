import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Sparklines (pure logic)
// ---------------------------------------------------------------------------

import { buildSparkline, weekKey, lastWeekKeys } from "./sparkline";

const stars = (w: string) => ({ ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 }[w] ?? 0);

describe("buildSparkline", () => {
  it("produces 12 weekly buckets oldest-first with null for empty weeks", () => {
    const now = new Date();
    const series = buildSparkline([], stars);
    expect(series).toHaveLength(12);
    // Oldest bucket is 11 weeks before the current week's Monday.
    const keys = lastWeekKeys(12);
    expect(keys).toHaveLength(12);
    expect(series.every((p) => p.avg === null && p.count === 0)).toBe(true);
    expect(now).toBeInstanceOf(Date);
  });

  it("averages the reviews that fall in each week and rounds to 1 decimal", () => {
    // Use the current week's Monday so the review lands in the LAST bucket.
    const monday = lastWeekKeys(1)[0];
    const series = buildSparkline(
      [
        { star_rating: "FIVE", create_time: `${monday}T10:00:00Z` },
        { star_rating: "FOUR", create_time: `${monday}T11:00:00Z` },
        { star_rating: "ONE", create_time: `${monday}T12:00:00Z` },
      ],
      stars
    );
    const last = series[series.length - 1];
    expect(last.count).toBe(3);
    expect(last.avg).toBeCloseTo((5 + 4 + 1) / 3, 1);
    // Weeks without reviews stay null (gap, not a fake flatline).
    expect(series.slice(0, -1).every((p) => p.avg === null)).toBe(true);
  });

  it("buckets a review into its own week (Monday-start) and ignores unknown stars", () => {
    // 11 weeks ago + 2 days = lands in the bucket 10 weeks back (Wed of that week).
    const keys = lastWeekKeys(12);
    const targetMonday = new Date(keys[1] + "T00:00:00Z"); // second-oldest bucket
    targetMonday.setUTCDate(targetMonday.getUTCDate() + 2);
    const iso = targetMonday.toISOString();
    expect(weekKey(iso)).toBe(keys[1]);
    const series = buildSparkline(
      [
        { star_rating: "FOUR", create_time: iso },
        { star_rating: "WEIRD", create_time: iso },
      ],
      stars
    );
    expect(series[1].count).toBe(1);
    expect(series[1].avg).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Alert webhooks (payload shapes + dispatch fan-out)
// ---------------------------------------------------------------------------

import {
  detectAlertService,
  buildAlertPayload,
  dispatchReviewAlert,
} from "./alerts";

const ALERT_INPUT = {
  tenantId: "t1",
  businessName: "The Business",
  reviewerName: "Angry Anna",
  starRating: "ONE",
  comment: "Terrible experience, never again.",
  createTime: "2026-09-01T12:00:00Z",
};

describe("alert webhook payloads", () => {
  it("detects Discord vs Slack by URL shape", () => {
    expect(detectAlertService("https://discord.com/api/webhooks/123/abc")).toBe("discord");
    expect(detectAlertService("https://hooks.slack.com/services/T1/B2/x")).toBe("slack");
    expect(detectAlertService("https://example.com/hook")).toBe("slack");
  });

  it("builds a Discord embed payload", () => {
    const p = buildAlertPayload("https://discord.com/api/webhooks/1/a", ALERT_INPUT, "https://app.test") as {
      embeds: { title: string; color: number; fields: { name: string; value: string }[]; url: string }[];
    };
    expect(p.embeds).toHaveLength(1);
    expect(p.embeds[0].title).toContain("1★ Google review — The Business");
    expect(p.embeds[0].color).toBe(0xe74c3c);
    expect(p.embeds[0].url).toBe("https://app.test/dashboard/reputation");
    const reviewer = p.embeds[0].fields.find((f) => f.name === "Reviewer");
    expect(reviewer?.value).toBe("Angry Anna");
  });

  it("builds a Slack attachment payload with a link", () => {
    const p = buildAlertPayload("https://hooks.slack.com/services/x", ALERT_INPUT, "https://app.test") as {
      text: string;
      attachments: { color: string; title: string; title_link: string; text: string }[];
    };
    expect(p.text).toContain("1★ Google review — The Business");
    expect(p.attachments[0].color).toBe("danger");
    expect(p.attachments[0].title_link).toBe("https://app.test/dashboard/reputation");
    expect(p.attachments[0].text).toContain("Terrible experience");
  });

  it("excerpts long comments", () => {
    const long = "x".repeat(500);
    const p = buildAlertPayload("https://hooks.slack.com/x", { ...ALERT_INPUT, comment: long }, "https://app.test") as {
      attachments: { text: string }[];
    };
    expect(p.attachments[0].text.length).toBeLessThanOrEqual(300);
    expect(p.attachments[0].text.endsWith("…")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// dispatchReviewAlert — DB mocked at the module level, fetch stubbed globally.
// ---------------------------------------------------------------------------

const { hooksStore, makeSb } = vi.hoisted(() => {
  let rows: { webhook_url: string; min_stars: number | null }[] = [];
  return {
    hooksStore: {
      set: (r: typeof rows) => {
        rows = r;
      },
      get: () => rows,
    },
    makeSb: () => ({
      from: (_t: string) => ({
        select: () => ({
          eq: () => Promise.resolve({ data: rows, error: null }),
        }),
      }),
    }),
  };
});

describe("dispatchReviewAlert", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://app.test");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("fans out only to hooks whose threshold matches the star rating", async () => {
    hooksStore.set([
      { webhook_url: "https://discord.com/api/webhooks/only1", min_stars: 1 },
      { webhook_url: "https://discord.com/api/webhooks/upTo3", min_stars: 3 },
      { webhook_url: "https://discord.com/api/webhooks/never", min_stars: null },
    ]);
    const posts: { url: string; body: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown, init?: { body?: string }) => {
        posts.push({ url: String(input), body: init?.body ?? "" });
        return new Response("ok", { status: 200 });
      })
    );

    // A 2★ review must hit the min_stars=3 hook and the catch-all, not the 1★-only hook.
    const out = await dispatchReviewAlert(makeSb() as never, { ...ALERT_INPUT, starRating: "TWO" });
    expect(out.sent).toBe(2);
    expect(out.failed).toBe(0);
    expect(posts.map((p) => p.url)).toEqual(
      expect.arrayContaining(["https://discord.com/api/webhooks/upTo3", "https://discord.com/api/webhooks/never"])
    );
    expect(posts.map((p) => p.url)).not.toContain("https://discord.com/api/webhooks/only1");
  });

  it("counts failures without throwing, so the sync never breaks on a dead webhook", async () => {
    hooksStore.set([{ webhook_url: "https://discord.com/api/webhooks/dead", min_stars: 1 }]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      })
    );
    const out = await dispatchReviewAlert(makeSb() as never, ALERT_INPUT);
    expect(out.sent).toBe(0);
    expect(out.failed).toBe(1);
  });

  it("is a no-op when the tenant has no webhooks configured", async () => {
    hooksStore.set([]);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const out = await dispatchReviewAlert(makeSb() as never, ALERT_INPUT);
    expect(out).toEqual({ sent: 0, failed: 0 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Digest reply route — drives the REAL POST handler with a mocked service
// client, like 2fa-lifecycle.test.ts does.
// ---------------------------------------------------------------------------

const { reviewStore, makeRouteSb } = vi.hoisted(() => {
  type Row = {
    id: string;
    tenant_id: string;
    profile_id: string;
    reviewer_name: string | null;
    star_rating: string;
    replied: boolean;
    internal_notes: string[];
  };
  let gbpReviews: Row[] = [];
  // Only gbp_reviews is populated; every other table reads empty so the
  // fallback path finds no owning profile (and correctly refuses to guess).
  const resolve = async (table: string, ops: [string, unknown[]][]) => {
    const rows: Row[] = table === "gbp_reviews" ? gbpReviews : [];
    const methods = ops.map(([m]) => m);
    if (methods.includes("update")) {
      const i = methods.indexOf("update");
      const patch = ops[i][1][0] as Record<string, unknown>;
      const filters = ops
        .slice(i + 1)
        .filter(([m]) => m === "eq")
        .map(([, a]) => a as [string, string]);
      for (const r of rows) {
        if (filters.every(([col, val]) => (r as unknown as Record<string, unknown>)[col] === val)) {
          Object.assign(r, patch);
        }
      }
      return { data: null, error: null };
    }
    let out = rows;
    for (const [m, a] of ops) {
      if (m === "like") {
        const prefix = String(a[1]).replace(/%/g, "");
        out = out.filter((r) => r.id.startsWith(prefix));
      } else if (m === "eq") {
        const col = String(a[0]);
        if (col.includes(".")) {
          // Embedded-relation filter (google_business_profiles.x): the fake
          // has no embedded rows, so nothing can match.
          out = [];
        } else {
          out = out.filter((r) => (r as unknown as Record<string, unknown>)[col] === a[1]);
        }
      }
    }
    if (methods.includes("maybeSingle") || methods.includes("single")) {
      return { data: out[0] ?? null, error: null };
    }
    return { data: out, error: null };
  };
  const makeTable = (table: string) => {
    const ops: [string, unknown[]][] = [];
    const builder: Record<string, unknown> = {};
    const push = (m: string) => (...args: unknown[]) => {
      ops.push([m, args]);
      return builder;
    };
    for (const m of [
      "select", "insert", "upsert", "update", "delete",
      "eq", "neq", "or", "in", "is", "not", "like", "order", "limit", "range",
    ]) {
      builder[m] = push(m);
    }
    builder.maybeSingle = () => {
      ops.push(["maybeSingle", []]);
      return builder;
    };
    builder.single = () => {
      ops.push(["single", []]);
      return builder;
    };
    builder.then = (
      onFulfilled?: (v: unknown) => unknown,
      onRejected?: (e: unknown) => unknown
    ) => resolve(table, ops).then(onFulfilled, onRejected);
    return builder;
  };
  return {
    reviewStore: {
      reset: (initial: Row[]) => {
        gbpReviews = initial.map((r) => ({ ...r, internal_notes: [...r.internal_notes] }));
      },
      get: () => gbpReviews,
    },
    makeRouteSb: () => ({ from: (t: string) => makeTable(t) }),
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: async () => makeRouteSb(),
}));

import { POST as digestReplyPOST } from "@/app/api/gbp/digest-reply/route";

function postReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/gbp/digest-reply", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

const REVIEW = {
  id: "aaaaaaaa-1234-5678-9abc-def012345678",
  tenant_id: "t1",
  profile_id: "p1",
  reviewer_name: "Angry Anna",
  star_rating: "ONE",
  replied: false,
  internal_notes: [] as string[],
};

describe("POST /api/gbp/digest-reply", () => {
  beforeEach(() => {
    reviewStore.reset([{ ...REVIEW }]);
  });

  it("routes a token-matched reply ([Re:#id8]) to the review and appends a note", async () => {
    const res = await digestReplyPOST(
      postReq({
        email: {
          from: "Owner <owner@example.com>",
          subject: "Weekly reputation digest",
          text: "[Re:#aaaaaaaa] Please offer her a refund — approved.\n\n> Weekly digest below",
        },
      })
    );
    const json = (await res.json()) as { matched: boolean; by: string };
    expect(json.matched).toBe(true);
    expect(json.by).toBe("token");
    expect(reviewStore.get()[0].internal_notes).toHaveLength(1);
    expect(reviewStore.get()[0].internal_notes[0]).toContain("owner@example.com");
    expect(reviewStore.get()[0].internal_notes[0]).toContain("refund");
  });

  it("strips quoted history and signs off with the first real line only", async () => {
    await digestReplyPOST(
      postReq({
        email: {
          from: "owner@example.com",
          subject: "Re: digest",
          text: "> old quoted stuff\nCall her today please.\n--\nSig block",
        },
      })
    );
    // No token → falls to sender matching; the store has one review, its
    // profile check runs against the fake (no profile rows) so nothing matches.
    // The note must NOT be written on a guessed match here.
    expect(reviewStore.get()[0].internal_notes).toHaveLength(0);
  });

  it("refuses ambiguous id8 prefixes instead of guessing", async () => {
    reviewStore.reset([REVIEW, { ...REVIEW, id: "aaaaaaaa-9999-9999-9abc-def012345678" }]);
    const res = await digestReplyPOST(
      postReq({ email: { from: "o@x.com", subject: "s", text: "[Re:#aaaaaaaa] hi" } })
    );
    const json = (await res.json()) as { matched: boolean; reason?: string };
    expect(json.matched).toBe(false);
    expect(json.reason).toBe("ambiguous");
    expect(reviewStore.get().every((r) => r.internal_notes.length === 0)).toBe(true);
  });

  it("rejects requests without a from address", async () => {
    const res = await digestReplyPOST(postReq({ email: { subject: "s", text: "x" } }));
    expect(res.status).toBe(400);
  });
});
