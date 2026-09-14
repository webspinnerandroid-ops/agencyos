import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * The grouper is the digest-friendliness contract of publish notifications:
 * 1 event keeps the per-post row; N events collapse into one per
 * (tenant, client, topic, kind) with per-post unread markers. DB calls are
 * mocked at the supabase-js boundary; createNotification is mocked to
 * capture what the bell would receive.
 */

const insertedRows: Record<string, unknown>[] = [];
const createNotificationCalls: Record<string, unknown>[] = [];

vi.mock("@/lib/in-app-notifications", () => ({
  createNotification: (input: Record<string, unknown>) => {
    createNotificationCalls.push(input);
    return Promise.resolve();
  },
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: (table: string) => ({
      insert: (rows: Record<string, unknown>[]) => {
        if (table === "notifications") insertedRows.push(...rows);
        return { error: null };
      },
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { name: "Decore Hotels" } }) }) }),
    }),
  }),
}));

import { PublishNotificationGrouper } from "./grouped-notifications";

const spec = {
  topic: "wp_hold",
  titleOne: "Auto-published to WordPress",
  titleMany: "Auto-published to WordPress — {client}",
  lineFor: (p: { title: string; detail: string }) => `• ${p.title} — ${p.detail}`,
  linkFor: (id: string) => `/dashboard/posts?post=${id}`,
  groupKeyFor: (id: string) => `post:${id}`,
};

const tenant = "t1";
const client = "c1";

describe("PublishNotificationGrouper", () => {
  beforeEach(() => {
    insertedRows.length = 0;
    createNotificationCalls.length = 0;
  });

  it("single event keeps the per-post notification shape (no marker row)", async () => {
    const g = new PublishNotificationGrouper(spec);
    g.add(tenant, client, { postId: "p1", title: "Post One", detail: "Scheduled for 2026-09-17", kind: "info" });
    await g.flush();

    expect(createNotificationCalls).toHaveLength(1);
    const n = createNotificationCalls[0];
    expect(n.title).toBe("Auto-published to WordPress");
    expect(n.groupKey).toBe("post:p1");
    expect(n.link).toBe("/dashboard/posts?post=p1");
    // The notification IS the unread row — no duplicate marker.
    expect(insertedRows).toHaveLength(0);
  });

  it("multiple events for one client collapse into ONE grouped row + per-post markers", async () => {
    const g = new PublishNotificationGrouper(spec);
    for (let i = 1; i <= 3; i++) {
      g.add(tenant, client, { postId: `p${i}`, title: `Post ${i}`, detail: "Scheduled for 2026-09-17", kind: "info" });
    }
    await g.flush();

    // Exactly one grouped notification for the pass.
    expect(createNotificationCalls).toHaveLength(1);
    const n = createNotificationCalls[0];
    expect(n.title).toBe("Auto-published to WordPress — Decore Hotels (3)");
    expect(n.link).toBe("/dashboard/scheduled");
    expect(String(n.body)).toContain("• Post 1 —");
    expect(String(n.body)).toContain("• Post 3 —");

    // One unread marker per post so per-post dots stay clearable.
    expect(insertedRows).toHaveLength(3);
    expect(insertedRows.map((r) => r.group_key)).toEqual(["post:p1", "post:p2", "post:p3"]);
    // Markers must NOT re-fan-out (they're direct inserts — nothing to check
    // beyond the count above, but the title matches the single-post shape).
    expect(insertedRows[0].title).toBe("Auto-published to WordPress");
  });

  it("separates buckets by tenant, client, and kind", async () => {
    const g = new PublishNotificationGrouper(spec);
    g.add(tenant, client, { postId: "p1", title: "A", detail: "d", kind: "info" });
    g.add("t2", client, { postId: "p2", title: "B", detail: "d", kind: "info" });
    g.add(tenant, "c2", { postId: "p3", title: "C", detail: "d", kind: "info" });
    g.add(tenant, client, { postId: "p4", title: "D", detail: "d", kind: "alert" });
    await g.flush();

    // 4 distinct buckets → 4 notifications, no cross-contamination.
    expect(createNotificationCalls).toHaveLength(4);
    expect(insertedRows).toHaveLength(0); // all single-post buckets
  });

  it("flush clears the buffer so a reused grouper starts fresh", async () => {
    const g = new PublishNotificationGrouper(spec);
    g.add(tenant, client, { postId: "p1", title: "A", detail: "d", kind: "info" });
    await g.flush();
    g.add(tenant, client, { postId: "p2", title: "B", detail: "d", kind: "info" });
    await g.flush();
    expect(createNotificationCalls).toHaveLength(2);
  });
});
