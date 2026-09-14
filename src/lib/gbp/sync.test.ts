import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — the sync under test (syncGbpReviewsForPair) touches the service
// client, the token refresh, notifications, and the AI drafter. Google's API
// is stubbed at global fetch level, keyed by URL.
// ---------------------------------------------------------------------------

/** Mutable holder — vitest hoists vi.mock factories, so they close over these. */
const mockDbHolder: { client: unknown } = { client: null };
const mockNotifyHolder: { fn: (input: unknown) => Promise<void> } = {
  fn: async () => {},
};

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: async () => mockDbHolder.client,
}));

vi.mock("@/lib/connections", () => ({
  getAccessToken: async () => ({ accessToken: "test-token", fresh: null }),
  encodeTokenBundle: (bundle: unknown) => JSON.stringify(bundle),
}));

vi.mock("@/lib/in-app-notifications", () => ({
  createNotification: (input: unknown) => mockNotifyHolder.fn(input),
}));

vi.mock("@/lib/gbp/drafting", () => ({
  draftReviewReply: async () => mockDraftHolder.fn(),
  fetchBrandContext: async () => "",
  starNumber: (word: string) =>
    ({ ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 }[word] ?? 0),
}));

const mockDraftHolder: { fn: () => Promise<{ response: string; tone: string; redFlags: string[]; escalate: boolean }> } = {
  fn: async () => ({
    response: "Lana's ready-to-post draft",
    tone: "calm, accountable",
    redFlags: [],
    escalate: false,
  }),
};

import { syncGbpReviewsForPair, type ServiceClient } from "./client";

// ---------------------------------------------------------------------------
// Fake Supabase: chainable builder that records every operation and resolves
// from a per-table row map. Filters are ignored (the sync's own scoping is
// verified by the tenant-isolation audit); what matters here is the DATA flow.
// ---------------------------------------------------------------------------

type Op = [method: string, args: unknown[]];

interface Recorded {
  /** google_business_profiles updates: { payload, ops } */
  updates: { table: string; payload: Record<string, unknown>; ops: Op[] }[];
  /** gbp_reviews upserts */
  upserts: { table: string; rows: Record<string, unknown>[]; opts: unknown }[];
}

interface TestDb {
  tables: Record<string, Record<string, unknown>[]>;
  recorded: Recorded;
}

function makeFakeDb(state: TestDb) {
  const build = (table: string, ops: Op[]) => {
    const builder: Record<string, unknown> = {};
    const push = (method: string) => (...args: unknown[]) => {
      ops.push([method, args]);
      return builder;
    };
    for (const m of [
      "select", "insert", "upsert", "update", "delete",
      "eq", "neq", "or", "in", "is", "not", "order", "limit", "range",
    ]) {
      builder[m] = push(m);
    }
    const resolve = () => {
      const methods = ops.map(([m]) => m);
      const last = ops[ops.length - 1];
      if (last?.[0] === "maybeSingle" || last?.[0] === "single") {
        return Promise.resolve({ data: state.tables[table]?.[0] ?? null, error: null });
      }
      if (methods.includes("upsert")) {
        const i = methods.lastIndexOf("upsert");
        state.recorded.upserts.push({
          table,
          rows: ops[i][1][0] as Record<string, unknown>[],
          opts: ops[i][1][1],
        });
        return Promise.resolve({ data: null, error: null });
      }
      // update() is never the terminal op (eq() filters follow), so look for
      // it anywhere in the chain.
      if (methods.includes("update")) {
        const i = methods.lastIndexOf("update");
        state.recorded.updates.push({
          table,
          payload: ops[i][1][0] as Record<string, unknown>,
          ops,
        });
        return Promise.resolve({ data: null, error: null });
      }
      if (methods.includes("insert") || methods.includes("delete")) {
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: state.tables[table] ?? [], error: null });
    };
    builder.maybeSingle = () => {
      ops.push(["maybeSingle", []]);
      return builder;
    };
    builder.single = () => {
      ops.push(["single", []]);
      return builder;
    };
    builder.then = (
      onFulfilled?: (v: { data: unknown; error: null }) => unknown,
      onRejected?: (e: unknown) => unknown
    ) => resolve().then(onFulfilled, onRejected);
    return builder;
  };
  return {
    from: (table: string) => build(table, []),
  } as unknown as ServiceClient;
}

function freshState(
  profileRow: Record<string, unknown>,
  reviewRows: Record<string, unknown>[]
): TestDb {
  return {
    tables: {
      google_business_profiles: [profileRow],
      gbp_reviews: reviewRows,
    },
    recorded: { updates: [], upserts: [] },
  };
}

// ---------------------------------------------------------------------------
// Google API stubbing
// ---------------------------------------------------------------------------

interface StubReview {
  reviewId: string;
  starRating: string;
  comment?: string;
  createTime?: string;
  reviewer?: { displayName?: string };
  reviewReply?: { comment?: string };
}

function stubGoogleApi(reviews: StubReview[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("mybusinessaccountmanagement.googleapis.com/v1/accounts")) {
        return Response.json({ accounts: [{ name: "accounts/ACC1", accountName: "Test Account" }] });
      }
      if (url.includes("/locations?")) {
        return Response.json({ locations: [{ name: "locations/L1", title: "The Business" }] });
      }
      if (url.includes("/reviews?")) {
        return Response.json({
          averageRating: 4.2,
          totalReviewCount: 87,
          reviews,
        });
      }
      return new Response("unexpected url: " + url, { status: 404 });
    })
  );
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROFILE = {
  id: "p1",
  tenant_id: "t1",
  workspace_id: null,
  account_name: "The Business",
  location_id: "locations/L1",
  encrypted_token: "enc-token",
  connected: true,
  baseline_synced: false,
};

const storedReview = (over: Partial<Record<string, unknown>> = {}) => ({
  review_id: "rev-A",
  profile_id: "p1",
  star_rating: "FIVE",
  comment: "Great!",
  reviewer_name: "Ann",
  create_time: "2026-08-01T10:00:00Z",
  replied: false,
  reply_comment: null,
  reply_text: null,
  notified_at: "2026-08-01T10:05:00Z",
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockDraftHolder.fn = async () => ({
    response: "Lana's ready-to-post draft",
    tone: "calm, accountable",
    redFlags: [],
    escalate: false,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("syncGbpReviewsForPair — baseline", () => {
  it("stores history silently on first sync except up to 3 unanswered low-star reviews", async () => {
    const googleReviews: StubReview[] = [
      { reviewId: "rev-old-1", starRating: "FIVE", comment: "Loved it", createTime: "2025-01-01T00:00:00Z", reviewer: { displayName: "Old Fan" }, reviewReply: { comment: "Thanks!" } },
      { reviewId: "rev-old-2", starRating: "FOUR", comment: "Good", createTime: "2025-02-01T00:00:00Z", reviewer: { displayName: "Old OK" } },
      { reviewId: "rev-old-3", starRating: "ONE", comment: "Terrible", createTime: "2025-03-01T00:00:00Z", reviewer: { displayName: "Angry" } },
    ];
    stubGoogleApi(googleReviews);
    const state = freshState(PROFILE, []);
    const notifyCalls: unknown[] = [];
    mockNotifyHolder.fn = async (input) => { notifyCalls.push(input); };

    const result = await syncGbpReviewsForPair(makeFakeDb(state), "t1", null);

    expect(result.ok).toBe(true);
    // All three stored…
    expect(state.recorded.upserts).toHaveLength(1);
    expect(state.recorded.upserts[0].rows).toHaveLength(3);
    // …but only the unanswered 1★ fired a notification (alert kind).
    expect(notifyCalls).toHaveLength(1);
    expect((notifyCalls[0] as { kind: string }).kind).toBe("alert");
    expect((notifyCalls[0] as { title: string }).title).toContain("1★");
    // The baseline flag is set so the next sync notifies on EVERY new review.
    const baselineUpdate = state.recorded.updates.find(
      (u) => u.table === "google_business_profiles" && "baseline_synced" in u.payload
    );
    expect(baselineUpdate?.payload.baseline_synced).toBe(true);
  });

  it("pre-drafts Lana replies for unanswered 1-2 star reviews", async () => {
    stubGoogleApi([
      { reviewId: "rev-bad", starRating: "TWO", comment: "Slow service", createTime: "2026-09-01T00:00:00Z", reviewer: { displayName: "Grumble" } },
    ]);
    const state = freshState(PROFILE, []);
    mockNotifyHolder.fn = async () => {};

    await syncGbpReviewsForPair(makeFakeDb(state), "t1", null);

    const draftUpdate = state.recorded.updates.find(
      (u) => u.table === "gbp_reviews" && "reply_text" in u.payload
    );
    expect(draftUpdate?.payload.reply_text).toBe("Lana's ready-to-post draft");
  });

  it("never pre-drafts for 3+ star reviews or already-replied reviews", async () => {
    stubGoogleApi([
      { reviewId: "rev-ok", starRating: "THREE", comment: "Fine", createTime: "2026-09-01T00:00:00Z", reviewer: { displayName: "Ok" } },
      { reviewId: "rev-answered", starRating: "ONE", createTime: "2026-09-02T00:00:00Z", reviewer: { displayName: "Sad" }, reviewReply: { comment: "Sorry!" } },
    ]);
    const state = freshState(PROFILE, []);
    mockNotifyHolder.fn = async () => {};

    await syncGbpReviewsForPair(makeFakeDb(state), "t1", null);

    expect(
      state.recorded.updates.filter(
        (u) => u.table === "gbp_reviews" && "reply_text" in u.payload
      )
    ).toHaveLength(0);
  });
});

describe("syncGbpReviewsForPair — post-baseline sync", () => {
  it("notifies on every genuinely-new review and skips known ones", async () => {
    stubGoogleApi([
      { reviewId: "rev-A", starRating: "FIVE", comment: "Great!", createTime: "2026-08-01T10:00:00Z", reviewer: { displayName: "Ann" } },
      { reviewId: "rev-B", starRating: "FOUR", comment: "Nice", createTime: "2026-09-01T10:00:00Z", reviewer: { displayName: "Bob" } },
    ]);
    const state = freshState(
      { ...PROFILE, baseline_synced: true },
      [storedReview()]
    );
    const notifyCalls: unknown[] = [];
    mockNotifyHolder.fn = async (input) => { notifyCalls.push(input); };

    const result = await syncGbpReviewsForPair(makeFakeDb(state), "t1", null);

    expect(result.ok).toBe(true);
    expect(result.newReviews).toBe(1);
    expect(notifyCalls).toHaveLength(1);
    expect((notifyCalls[0] as { title: string }).title).toContain("4★");
    // Baseline already set — no re-flagging.
    expect(
      state.recorded.updates.find(
        (u) => u.table === "google_business_profiles" && "baseline_synced" in u.payload
      )
    ).toBeUndefined();
  });

  it("keeps locally drafted replies across re-syncs (never overwrites reply_text)", async () => {
    stubGoogleApi([
      { reviewId: "rev-A", starRating: "FIVE", comment: "Great!", createTime: "2026-08-01T10:00:00Z", reviewer: { displayName: "Ann" } },
    ]);
    const state = freshState(
      { ...PROFILE, baseline_synced: true },
      [storedReview({ reply_text: "DRAFT-KEEP-ME" })]
    );
    mockNotifyHolder.fn = async () => {};

    const result = await syncGbpReviewsForPair(makeFakeDb(state), "t1", null);

    expect(result.ok).toBe(true);
    expect(result.newReviews).toBe(0);
    // The upsert payload never touches reply_text/notified_at…
    const upsertRow = state.recorded.upserts[0].rows[0];
    expect(upsertRow).not.toHaveProperty("reply_text");
    expect(upsertRow).not.toHaveProperty("notified_at");
    // …and no gbp_reviews update writes reply_text on re-sync.
    expect(
      state.recorded.updates.filter(
        (u) => u.table === "gbp_reviews" && "reply_text" in u.payload
      )
    ).toHaveLength(0);
    // The draft is still surfaced to the UI.
    expect(result.listings[0].reviews[0].draftedReply).toBe("DRAFT-KEEP-ME");
    expect(result.listings[0].reviews[0].hasDraft).toBe(true);
  });

  it("caches Google's aggregate rating/count on the listing row", async () => {
    stubGoogleApi([
      { reviewId: "rev-A", starRating: "FIVE", createTime: "2026-08-01T10:00:00Z", reviewer: { displayName: "Ann" } },
    ]);
    const state = freshState({ ...PROFILE, baseline_synced: true }, [storedReview()]);
    mockNotifyHolder.fn = async () => {};

    await syncGbpReviewsForPair(makeFakeDb(state), "t1", null);

    const statsUpdate = state.recorded.updates.find(
      (u) => u.table === "google_business_profiles" && "average_rating" in u.payload
    );
    expect(statsUpdate?.payload.average_rating).toBe(4.2);
    expect(statsUpdate?.payload.total_review_count).toBe(87);
  });
});

describe("syncGbpReviewsForPair — 1★ webhook alerts", () => {
  it("fans a new 1★ review out to the tenant's configured alert webhook", async () => {
    const posted: string[] = [];
    stubGoogleApi([
      { reviewId: "rev-disaster", starRating: "ONE", comment: "Awful", createTime: "2026-09-02T00:00:00Z", reviewer: { displayName: "Furious" } },
    ]);
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: { body?: string }) => {
      const url = String(input);
      if (url.includes("discord.com/api/webhooks")) {
        posted.push(init?.body ?? "");
        return new Response("ok", { status: 200 });
      }
      return (realFetch as unknown as (i: unknown, init?: { body?: string }) => Promise<Response>)(input, init);
    }));
    const state = freshState({ ...PROFILE, baseline_synced: true }, []);
    state.tables.gbp_alert_webhooks = [
      { webhook_url: "https://discord.com/api/webhooks/123/abc", min_stars: 1 },
    ];
    mockNotifyHolder.fn = async () => {};

    const result = await syncGbpReviewsForPair(makeFakeDb(state), "t1", null);

    expect(result.ok).toBe(true);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain("The Business");
    // Clean up the extra table so other tests' state shapes stay untouched.
    delete state.tables.gbp_alert_webhooks;
  });
});

describe("syncGbpReviewsForPair — failure isolation", () => {
  it("reports a per-listing error instead of failing the pair", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes("mybusinessaccountmanagement")) {
          return Response.json({ accounts: [{ name: "accounts/ACC1" }] });
        }
        if (url.includes("/locations?")) {
          return Response.json({ locations: [{ name: "locations/L1", title: "The Business" }] });
        }
        // Reviews endpoint is down.
        return new Response("boom", { status: 500 });
      })
    );
    const state = freshState({ ...PROFILE, baseline_synced: true }, []);
    mockNotifyHolder.fn = async () => {};

    const result = await syncGbpReviewsForPair(makeFakeDb(state), "t1", null);

    expect(result.ok).toBe(true);
    expect(result.listings[0].error).toBeTruthy();
    expect(result.listings[0].reviews).toHaveLength(0);
  });
});
